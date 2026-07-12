"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { extractDocumentText } from "@/lib/documents/extractDocumentText";
import { revalidatePath } from "next/cache";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";

export async function submitDocumentAction(formData: FormData) {
  // Standing Rule 1: supabase.auth.getUser() first line
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized: Please log in." };
  }

  // 1. Get corresponding patient record
  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id")
    .eq("profile_id", user.id)
    .single();

  if (patientError || !patient) {
    return { success: false, error: "Patient profile is not configured. Contact clinic staff." };
  }

  // 2. Validate form inputs
  const file = formData.get("file") as File;
  if (!file || file.size === 0) {
    return { success: false, error: "No file provided." };
  }

  // Cap size at 5MB (5 * 1024 * 1024 bytes)
  if (file.size > 5 * 1024 * 1024) {
    return { success: false, error: "File exceeds the 5MB size limit." };
  }

  // Validate mime type
  const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
  if (!allowedTypes.includes(file.type)) {
    return { success: false, error: "Only PDF, JPG, and PNG files are allowed." };
  }

  // 3. Generate file path under patient folder prefix: auth.uid() / file_uuid . extension
  const fileExtension = file.name.split(".").pop();
  const fileUuid = crypto.randomUUID();
  const filePath = `${user.id}/${fileUuid}.${fileExtension}`;

  // 4. Upload file to private Storage bucket
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("patient-documents")
    .upload(filePath, fileBuffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[submitDocumentAction] Storage upload error:", uploadError);
    return { success: false, error: `Failed to upload file to storage: ${uploadError.message}` };
  }

  // 5. Insert documents row using user Supabase client
  const { data: docRow, error: insertError } = await supabase
    .from("documents")
    .insert({
      patient_id: patient.id,
      uploader_id: user.id,
      file_name: file.name,
      file_path: filePath,
      file_type: file.type,
      status: "pending",
    })
    .select()
    .single();

  // 6. Database insert failure -> Delete orphan file from Storage
  if (insertError) {
    console.error("[submitDocumentAction] DB insert error, initiating orphan cleanup:", insertError);
    const { error: removeError } = await supabase.storage
      .from("patient-documents")
      .remove([filePath]);
    if (removeError) {
      console.error("[submitDocumentAction] Orphan cleanup failed to delete file:", removeError);
    } else {
      console.log("[submitDocumentAction] Orphan cleanup deleted file successfully:", filePath);
    }
    return { success: false, error: "Failed to save document. Please try again." };
  }

  // 7. Non-blocking pluggable text extraction
  try {
    const extractionResult = await extractDocumentText(fileBuffer, file.type);
    if (extractionResult) {
      if (extractionResult.text) {
        const { error: updateError } = await supabase
          .from("documents")
          .update({ ocr_text: extractionResult.text })
          .eq("id", docRow.id);
        if (updateError) {
          console.error("[submitDocumentAction] Failed to update OCR text in document row:", updateError);
        }
      }

      try {
        await logEvent(
          supabase,
          user.id,
          SYSTEM_EVENT_TYPES.DOCUMENT_OCR_PROCESSED,
          "Document OCR processed via Google Generative AI",
          null,
          {
            document_id: docRow.id,
            prompt_token_count: extractionResult.promptTokenCount,
            candidates_token_count: extractionResult.candidatesTokenCount,
            total_token_count: extractionResult.totalTokenCount,
          }
        );
      } catch (logError) {
        console.error("[submitDocumentAction] Non-blocking OCR event logging error:", logError);
      }
    }
  } catch (ocrError) {
    console.error("[submitDocumentAction] Non-blocking OCR error during text extraction:", ocrError);
  }

  // 8. Log the event
  await logEvent(
    supabase,
    user.id,
    SYSTEM_EVENT_TYPES.DOCUMENT_SUBMITTED,
    `Patient submitted document: ${file.name}`,
    null,
    { document_id: docRow.id, file_name: file.name }
  );

  revalidatePath("/patient/submissions");
  revalidatePath("/patient/dashboard");

  return { success: true };
}
