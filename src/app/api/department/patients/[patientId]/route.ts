import { createClient } from "@/lib/supabase/server";
import { requireAnyPermission } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";

export async function GET(
  request: Request,
  { params }: { params: { patientId: string } }
) {
  const supabase = createClient();
  const { patientId } = params;

  if (!patientId) {
    return errorResponse("patientId parameter is required", 400);
  }

  try {
    // 1. Enforce roles
    const profile = await requireAnyPermission(["records.manage", "records.manage.own_dept"]);

    // 2. Determine target department
    const { searchParams } = new URL(request.url);
    let dept = searchParams.get("department");

    if (profile.role === "department_staff") {
      dept = profile.department;
      if (!dept) {
        return errorResponse("Staff member is not assigned to a department", 400);
      }
    } else {
      dept = dept || "laboratory";
    }

    // 3. Fetch patient demographics
    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("*")
      .eq("id", patientId)
      .single();

    if (patientError || !patient) {
      return errorResponse("Patient not found", 404, patientError?.message);
    }

    // 4. Fetch patient's history for this department
    const { data: history, error: historyError } = await supabase
      .from("department_records")
      .select(`
        id,
        test_type,
        test_name,
        test_value,
        unit,
        reference_range_min,
        reference_range_max,
        is_flagged,
        notes,
        created_at,
        recorder:recorder_id (
          id,
          full_name
        )
      `)
      .eq("patient_id", patientId)
      .eq("department", dept)
      .order("created_at", { ascending: false });

    if (historyError) {
      throw historyError;
    }

    return successResponse(
      {
        patient,
        history: history || []
      },
      "Patient data and history retrieved successfully"
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse("Failed to fetch patient details", 500, message);
  }
}
