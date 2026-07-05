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

    const { searchParams } = new URL(request.url);
    const metric = searchParams.get("metric")?.trim() || "";

    let queryBuilder = supabase
      .from("specialist_records")
      .select(`
        id,
        specialist_patient_id,
        specialist_id,
        test_type,
        test_name,
        test_value,
        unit,
        reference_range_min,
        reference_range_max,
        is_flagged,
        notes,
        created_at,
        updated_at,
        recorder:specialist_id (
          id,
          full_name
        )
      `)
      .eq("specialist_patient_id", patientId)
      .order("created_at", { ascending: true });

    if (metric) {
      queryBuilder = queryBuilder.eq("test_name", metric);
    }

    const { data: records, error: recordsError } = await queryBuilder;

    if (recordsError) {
      throw recordsError;
    }

    // Map created_at to result_date and normalize recorder
    const formattedRecords = (records || []).map((r) => {
      const rawRecorder = r.recorder;
      const recorderObj = Array.isArray(rawRecorder)
        ? rawRecorder[0]
        : (rawRecorder as unknown as { id: string; full_name: string } | null);

      return {
        ...r,
        patient_id: r.specialist_patient_id,
        department: r.test_type,
        result_date: r.created_at,
        recorder: recorderObj ? { id: recorderObj.id, full_name: recorderObj.full_name } : null,
      };
    });

    return successResponse(formattedRecords, "Patient chronological records fetched successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to fetch chronological patient records:", message);
    return errorResponse("Failed to fetch chronological patient records", 500);
  }
}
