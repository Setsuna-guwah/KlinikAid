import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { getPhtStartOfToday } from "@/lib/utils";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";

export async function GET(request: Request) {
  const supabase = createClient();

  try {
    const profile = await requireRole(["admin", "department_staff"]);

    // Determine target department
    const { searchParams } = new URL(request.url);
    let dept = searchParams.get("department");

    if (profile.role === "department_staff") {
      dept = profile.department;
      if (!dept) {
        return errorResponse("Staff member is not assigned to a department", 400);
      }
    } else {
      // Admin
      dept = dept || "laboratory";
    }

    if (!["laboratory", "imaging", "ultrasound", "ecg"].includes(dept)) {
      return errorResponse("Invalid department requested", 400);
    }

    // Fetch department records with patient details
    const { data: records, error: recordsError } = await supabase
      .from("department_records")
      .select(`
        id,
        patient_id,
        recorder_id,
        department,
        test_type,
        test_name,
        test_value,
        unit,
        reference_range_min,
        reference_range_max,
        is_flagged,
        notes,
        created_at,
        patient:patient_id (
          id,
          first_name,
          last_name
        ),
        recorder:recorder_id (
          id,
          full_name
        )
      `)
      .eq("department", dept)
      .order("created_at", { ascending: false });

    if (recordsError) {
      throw recordsError;
    }

    return successResponse(records || [], "Department records retrieved successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse("Failed to fetch department records", 500, message);
  }
}

interface TestResultInput {
  test_name: string;
  test_value: string | number;
  unit?: string | null;
  reference_range_min?: number | string | null;
  reference_range_max?: number | string | null;
  is_flagged?: boolean;
}

export async function POST(request: Request) {
  const supabase = createClient();

  // 1. Session Check
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // 2. Role Check (Only admins or department_staff can enter results)
    const profile = await requireRole(["admin", "department_staff"]);

    // 3. Parse request body
    const body = await request.json();
    const { patient_id, test_type, notes } = body;
    const results = body.results as TestResultInput[];

    if (!patient_id) {
      return errorResponse("patient_id is required", 400);
    }
    if (!test_type) {
      return errorResponse("test_type is required", 400);
    }
    if (!results || !Array.isArray(results) || results.length === 0) {
      return errorResponse("results array is required and must not be empty", 400);
    }

    // Determine department
    let dept = profile.department;
    if (profile.role === "admin") {
      // If admin, we expect department to be passed in body, or default to laboratory
      dept = body.department || "laboratory";
    }

    if (!dept || !["laboratory", "imaging", "ultrasound", "ecg"].includes(dept)) {
      return errorResponse("Valid department assignment is required", 400);
    }

    // 4. Format rows for bulk relational insert
    const rowsToInsert = results.map((res) => {
      if (!res.test_name) {
        throw new Error("Each result must have a test_name");
      }
      if (res.test_value === undefined || res.test_value === null) {
        throw new Error(`test_value is required for test ${res.test_name}`);
      }

      return {
        patient_id,
        recorder_id: user.id,
        department: dept,
        test_type,
        test_name: res.test_name,
        test_value: String(res.test_value),
        unit: res.unit || null,
        reference_range_min: res.reference_range_min !== undefined && res.reference_range_min !== null ? Number(res.reference_range_min) : null,
        reference_range_max: res.reference_range_max !== undefined && res.reference_range_max !== null ? Number(res.reference_range_max) : null,
        is_flagged: !!res.is_flagged,
        notes: notes || null
      };
    });

    // 5. Perform insert
    const { data: insertedData, error: insertError } = await supabase
      .from("department_records")
      .insert(rowsToInsert)
      .select();

    if (insertError) {
      throw insertError;
    }

    // 6. Update today's queue entry status from 'waiting' or 'in_progress' to 'completed'
    const startOfTodayIso = getPhtStartOfToday();

    const { data: updatedQueue, error: queueError } = await supabase
      .from("patient_queue")
      .update({ 
        status: "completed",
        updated_at: new Date().toISOString()
      })
      .eq("patient_id", patient_id)
      .eq("department", dept)
      .in("status", ["waiting", "in_progress"])
      .gte("created_at", startOfTodayIso)
      .select("id");

    if (queueError) {
      console.error("Warning: Failed to update patient queue status:", queueError);
    }

    const completedCount = updatedQueue?.length || 0;

    // 7. Log audit trail events
    const flaggedCount = results.filter((r) => r.is_flagged).length;
    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.RECORD_ENTERED,
      `Entered results for patient in ${dept} department. Total tests: ${results.length}, Flagged: ${flaggedCount}`,
      null,
      {
        patient_id,
        department: dept,
        test_type,
        flagged_count: flaggedCount,
        total_count: results.length
      }
    );

    if (completedCount > 0) {
      await logEvent(
        supabase,
        user.id,
        SYSTEM_EVENT_TYPES.QUEUE_COMPLETED,
        `Patient queue entry marked completed for ${dept} department. Updated rows: ${completedCount}`,
        null,
        {
          patient_id,
          department: dept,
          completed_count: completedCount
        }
      );
    }

    return successResponse(insertedData, "Department records saved successfully", 201);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse("Failed to save department records", 500, message);
  }
}
