import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";
import { getPhtStartOfToday } from "@/lib/utils";

export async function GET(request: Request) {
  const supabase = createClient();

  try {
    // 1. Enforce admin or department_staff roles
    const profile = await requireRole(["admin", "department_staff"]);

    // 2. Determine target department
    const { searchParams } = new URL(request.url);
    let dept = searchParams.get("department");

    if (profile.role === "department_staff") {
      dept = profile.department;
      if (!dept) {
        return errorResponse("Staff member is not assigned to a department", 400);
      }
    } else {
      // For Admin, default to 'laboratory' if none specified
      dept = dept || "laboratory";
    }

    if (!["laboratory", "imaging", "ultrasound", "ecg"].includes(dept)) {
      return errorResponse("Invalid department requested", 400);
    }

    // 3. Get start of today in Asia/Manila (UTC+8)
    const startOfTodayIso = getPhtStartOfToday();


    // 4. Fetch today's waiting or in_progress queue entries for the department
    const { data: queue, error: queueError } = await supabase
      .from("patient_queue")
      .select(`
        id,
        patient_id,
        department,
        status,
        priority_level,
        triage_notes,
        created_at,
        patient:patient_id (
          id,
          first_name,
          last_name,
          gender,
          date_of_birth
        )
      `)
      .eq("department", dept)
      .gte("created_at", startOfTodayIso)
      .in("status", ["waiting", "in_progress"])
      .order("created_at", { ascending: true });

    if (queueError) {
      throw queueError;
    }

    return successResponse(queue || [], "Daily queue retrieved successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse("Failed to fetch department queue", 500, message);
  }
}
