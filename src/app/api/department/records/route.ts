import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPermission, requireAnyPermission } from "@/lib/auth/helpers";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { validateLabResult } from "@/lib/records/validateLabResult";

export async function GET(request: Request) {
  const supabase = createClient();

  try {
    const profile = await requireAnyPermission(["records.manage", "records.manage.own_dept"]);

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
    return handleRouteError(error, "Failed to fetch department records");
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
    const profile = await requireAnyPermission(["records.manage", "records.manage.own_dept"]);

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
    const canSelectDepartmentContext = await hasPermission(profile.id, "records.manage");
    let dept = profile.department;
    if (canSelectDepartmentContext) {
      dept = body.department || profile.department || "laboratory";
    }

    if (!dept || !["laboratory", "imaging", "ultrasound", "ecg"].includes(dept)) {
      return errorResponse("Valid department assignment is required", 400);
    }

    let patientGender: string | null = null;
    if (dept === "laboratory") {
      const { data: patient, error: patientError } = await supabase
        .from("patients")
        .select("gender")
        .eq("id", patient_id)
        .single();

      if (patientError || !patient) {
        return errorResponse("Patient record not found", 404);
      }

      patientGender = patient.gender;
    }

    // 4. Format rows for bulk relational insert
    const rowsToInsert = results.map((res) => {
      if (!res.test_name) {
        throw new Error("Each result must have a test_name");
      }
      if (res.test_value === undefined || res.test_value === null) {
        throw new Error(`test_value is required for test ${res.test_name}`);
      }

      if (dept === "laboratory") {
        const validated = validateLabResult(res.test_name, res.test_value, patientGender);

        return {
          patient_id,
          recorder_id: user.id,
          department: dept,
          test_type,
          test_name: res.test_name,
          test_value: validated.test_value,
          unit: validated.unit,
          reference_range_min: validated.reference_range_min,
          reference_range_max: validated.reference_range_max,
          is_flagged: validated.is_flagged,
          notes: notes || null
        };
      }

      return {
        patient_id,
        recorder_id: user.id,
        department: dept,
        test_type,
        test_name: res.test_name,
        test_value: String(res.test_value),
        unit: res.unit || null,
        reference_range_min: null,
        reference_range_max: null,
        is_flagged: false,
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

    // 6. Update the patient's open queue entry for this department to 'completed'.
    //
    // Deliberately NOT filtered by date. This query used to require
    // `created_at >= start-of-PHT-today` while the department's queue list had
    // the same filter and reception's re-triage guard had none. An entry opened
    // before PHT midnight was invisible to the department, un-re-triable, and
    // could never be closed by this path. All three must stay unfiltered so that
    // "blocks reception" and "is actionable by the department" stay equivalent.
    //
    // These two writes are NOT atomic. The results above are already committed
    // by the time this runs, so a failure here cannot be rolled back and must
    // not be reported as if the whole operation succeeded -- see the response
    // below. Making this atomic needs a Postgres function taking both writes
    // together, in the shape of `archive_specialist_patient` from
    // migration_22; that is tracked separately because it requires DDL.
    const { data: updatedQueue, error: queueError } = await supabase
      .from("patient_queue")
      .update({
        status: "completed",
        updated_at: new Date().toISOString()
      })
      .eq("patient_id", patient_id)
      .eq("department", dept)
      .in("status", ["waiting", "in_progress"])
      .select("id");

    if (queueError) {
      console.error("Warning: Failed to update patient queue status:", queueError);
    }

    const completedCount = updatedQueue?.length || 0;

    // 7. Log audit trail events
    const flaggedCount = rowsToInsert.filter((r) => r.is_flagged).length;
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

    // The client cannot tell a partial success from a full one unless the
    // response says which happened. Two distinct outcomes, both of which used to
    // reach the technologist as "saved and queue updated successfully!":
    //
    //   - the update errored, so the patient is still queued and open;
    //   - the update matched no row, so there was no open entry to close, which
    //     usually means the patient was never routed to this department.
    //
    // Both leave reception blocked from re-triaging by the 409 guard, so both are
    // reported rather than assumed away. The records themselves did save, so the
    // status stays 201 -- returning 500 here would invite a retry that
    // duplicates every result row.
    return NextResponse.json(
      {
        success: true,
        message:
          completedCount > 0
            ? "Department records saved successfully"
            : "Department records saved, but the patient's queue entry was not closed",
        data: {
          records: insertedData,
          queue: {
            department: dept,
            completed_count: completedCount,
            closed: completedCount > 0,
            // True when the update ran cleanly but matched no open entry.
            matched_open_entry: completedCount > 0,
            // Set when the update itself failed.
            error: queueError
              ? "The queue update failed. The patient is still listed as open for this department."
              : null,
          },
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to save department records");
  }
}
