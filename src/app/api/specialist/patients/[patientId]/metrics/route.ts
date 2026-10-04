// IMPORTANT: This route queries Supabase PostgreSQL directly. No LLM is involved. See SO-C.

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";

export async function GET(
  request: Request,
  { params }: { params: { patientId: string } }
) {
  const supabase = createClient();
  const { patientId } = params;

  // Rule 1 check: calling getUser() as the literal first line
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("UNAUTHORIZED: Session not found", 401);
  }

  try {
    await requirePermission("specialist.analytics");

    if (!patientId) {
      return errorResponse("Patient ID is required", 400);
    }

    // Fetch distinct test names for the patient from specialist_records
    const { data: records, error: recordsError } = await supabase
      .from("specialist_records")
      .select("test_name")
      .eq("specialist_patient_id", patientId);

    if (recordsError) {
      throw recordsError;
    }

    const testNames = Array.from(
      new Set((records || []).map((r) => r.test_name).filter(Boolean))
    );

    return successResponse(testNames, "Distinct patient metrics fetched successfully");
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to fetch patient metrics");
  }
}
