import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { toZonedTime, format } from "date-fns-tz";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();

  // 1. Session Check (Rule 1)
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // 2. Role Check (Rule 2)
    const profile = await requirePermission("documents.manage");
    const documentId = params.id;

    // 3. Parse and validate payload
    let body: { rejection_reason?: string } = {};
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON payload", 400);
    }

    const rejectionReason = body.rejection_reason?.trim();
    if (!rejectionReason || rejectionReason.length < 20) {
      return errorResponse(
        "Rejection reason is required and must be at least 20 characters long.",
        400
      );
    }

    // 4. Fetch current document to preserve metadata
    const { data: document, error: fetchError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (fetchError || !document) {
      return errorResponse("Document not found", 404, fetchError?.message);
    }

    // 5. Build updated metadata with reject details and UTC+8 timestamp (Rule 9)
    const timeZone = "Asia/Manila";
    const zonedTime = toZonedTime(new Date(), timeZone);
    const phTimestamp = format(zonedTime, "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone });

    const currentMetadata = typeof document.extracted_metadata === "object" && document.extracted_metadata !== null
      ? (document.extracted_metadata as Record<string, unknown>)
      : {};

    const updatedMetadata = {
      ...currentMetadata,
      reviewed_by: user.id,
      reviewed_by_name: profile.full_name,
      reviewed_at: phTimestamp,
      review_notes: rejectionReason,
    };

    // 6. Update document in Database
    const { data: updatedDoc, error: updateError } = await supabase
      .from("documents")
      .update({
        status: "rejected",
        rejection_reason: rejectionReason,
        extracted_metadata: updatedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .select(`
        *,
        patient:patient_id (
          id,
          first_name,
          last_name,
          date_of_birth,
          gender,
          contact_number,
          email,
          address
        )
      `)
      .single();

    if (updateError || !updatedDoc) {
      throw updateError || new Error("Failed to update document");
    }

    // 7. Log mutation event (Rule 5)
    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.DOCUMENT_REJECTED,
      `Document rejected: ${updatedDoc.file_name} for patient ${updatedDoc.patient?.first_name} ${updatedDoc.patient?.last_name}. Reason: ${rejectionReason}`,
      null,
      { document_id: documentId, rejection_reason: rejectionReason }
    );

    return successResponse(updatedDoc, "Document rejected successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse("Failed to reject document", 500, message);
  }
}
