// IMPORTANT: This route queries Supabase PostgreSQL directly. No LLM is involved. See SO-C.

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";

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
    await requireRole(["admin", "medical_specialist"]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isForbidden = message.includes("FORBIDDEN");
    return errorResponse(message, isForbidden ? 403 : 401);
  }

  try {

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
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to fetch patient metrics:", message);
    return errorResponse("Failed to fetch patient metrics", 500);
  }
}
