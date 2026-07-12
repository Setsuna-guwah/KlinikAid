"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { extractDocumentText } from "@/lib/documents/extractDocumentText";
import { revalidatePath } from "next/cache";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const DOCUMENT_BUCKET = "patient-documents";

interface PendingDocumentOcrRow {
  id: string;
  patient_id: string;
  file_name: string;
  file_type: string;
  file_path: string;
  ocr_text: string;
}

function validateAssessmentId(assessmentId: unknown): assessmentId is string {
  return typeof assessmentId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assessmentId);
}

function getFileExtension(fileName: string, fileType: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension) return extension;
  if (fileType === "application/pdf") return "pdf";
  if (fileType === "image/png") return "png";
  return "jpg";
}

async function getPatientForCurrentUser(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id")
    .eq("profile_id", userId)
    .single();

  if (patientError || !patient) {
    return { patient: null, error: "Patient profile is not configured. Contact clinic staff." };
  }

  return { patient, error: null };
}

function validateUploadedFile(file: File | null) {
  if (!file || file.size === 0) {
    return "No file provided.";
  }

  if (file.size > MAX_FILE_SIZE) {
    return "File exceeds the 5MB size limit.";
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Only PDF, JPG, and PNG files are allowed.";
  }

  return null;
}

export async function assessDocumentQualityAction(formData: FormData) {
  // Standing Rule 1: supabase.auth.getUser() first line
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized: Please log in." };
  }

  const { patient, error: patientError } = await getPatientForCurrentUser(supabase, user.id);
  if (patientError || !patient) {
    return { success: false, error: patientError };
  }

  const file = formData.get("file") as File | null;
  const validationError = validateUploadedFile(file);
  if (validationError || !file) {
    return { success: false, error: validationError || "Invalid file." };
  }

  const assessmentId = crypto.randomUUID();
  const fileExtension = getFileExtension(file.name, file.type);
  const pendingFilePath = `${user.id}/pending-submissions/${assessmentId}/source.${fileExtension}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(pendingFilePath, fileBuffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[assessDocumentQualityAction] Pending file upload error:", uploadError);
    return { success: false, error: `Failed to upload file for assessment: ${uploadError.message}` };
  }

  let ocrText = "";
  let promptTokenCount: number | null = null;
  let candidatesTokenCount: number | null = null;
  let totalTokenCount: number | null = null;

  try {
    const extractionResult = await extractDocumentText(fileBuffer, file.type);
    if (extractionResult) {
      ocrText = extractionResult.text || "";
      promptTokenCount = extractionResult.promptTokenCount;
      candidatesTokenCount = extractionResult.candidatesTokenCount;
      totalTokenCount = extractionResult.totalTokenCount;

      try {
        await logEvent(
          supabase,
          user.id,
          SYSTEM_EVENT_TYPES.DOCUMENT_OCR_PROCESSED,
          "Document OCR processed via Google Generative AI",
          null,
          {
            assessment_id: assessmentId,
            prompt_token_count: promptTokenCount,
            candidates_token_count: candidatesTokenCount,
            total_token_count: totalTokenCount,
          }
        );
      } catch (logError) {
        console.error("[assessDocumentQualityAction] Non-blocking OCR event logging error:", logError);
      }
    }
  } catch (ocrError) {
    console.error("[assessDocumentQualityAction] OCR error during quality assessment:", ocrError);
  }

  const { error: pendingError } = await supabase
    .from("pending_document_ocr")
    .insert({
      id: assessmentId,
      user_id: user.id,
      patient_id: patient.id,
      file_name: file.name,
      file_type: file.type,
      file_path: pendingFilePath,
      ocr_text: ocrText,
      prompt_token_count: promptTokenCount,
      candidates_token_count: candidatesTokenCount,
      total_token_count: totalTokenCount,
    });

  if (pendingError) {
    console.error("[assessDocumentQualityAction] Pending OCR insert error:", pendingError);
    await supabase.storage.from(DOCUMENT_BUCKET).remove([pendingFilePath]);
    return { success: false, error: "Failed to save document assessment. Please try again." };
  }

  return {
    success: true,
    assessmentId,
    isOcrTextEmpty: ocrText.trim().length === 0,
  };
}

export async function confirmSubmitDocumentAction(assessmentId: string) {
  // Standing Rule 1: supabase.auth.getUser() first line
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized: Please log in." };
  }

  if (!validateAssessmentId(assessmentId)) {
    return { success: false, error: "Invalid document assessment reference." };
  }

  const { patient, error: patientError } = await getPatientForCurrentUser(supabase, user.id);
  if (patientError || !patient) {
    return { success: false, error: patientError };
  }

  const { data: pendingRow, error: pendingError } = await supabase
    .from("pending_document_ocr")
    .select("id, patient_id, file_name, file_type, file_path, ocr_text")
    .eq("id", assessmentId)
    .eq("user_id", user.id)
    .single<PendingDocumentOcrRow>();

  if (pendingError || !pendingRow) {
    return { success: false, error: "Document assessment expired or was not found. Please upload the file again." };
  }

  if (pendingRow.patient_id !== patient.id) {
    return { success: false, error: "Document assessment does not match your patient profile." };
  }

  const { data: pendingFile, error: downloadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .download(pendingRow.file_path);

  if (downloadError || !pendingFile) {
    console.error("[confirmSubmitDocumentAction] Pending file download error:", downloadError);
    return { success: false, error: "Failed to retrieve assessed file. Please upload it again." };
  }

  const fileExtension = getFileExtension(pendingRow.file_name, pendingRow.file_type);
  const finalFilePath = `${user.id}/${crypto.randomUUID()}.${fileExtension}`;
  const finalFileBuffer = Buffer.from(await pendingFile.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(finalFilePath, finalFileBuffer, {
      contentType: pendingRow.file_type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[confirmSubmitDocumentAction] Final storage upload error:", uploadError);
    return { success: false, error: `Failed to upload file to storage: ${uploadError.message}` };
  }

  const trimmedOcrText = pendingRow.ocr_text.trim();
  const documentInsert = {
    patient_id: patient.id,
    uploader_id: user.id,
    file_name: pendingRow.file_name,
    file_path: finalFilePath,
    file_type: pendingRow.file_type,
    status: "pending",
    ...(trimmedOcrText ? { ocr_text: pendingRow.ocr_text } : {}),
  };

  const { data: docRow, error: insertError } = await supabase
    .from("documents")
    .insert(documentInsert)
    .select()
    .single();

  if (insertError) {
    console.error("[confirmSubmitDocumentAction] DB insert error, initiating orphan cleanup:", insertError);
    const { error: removeError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([finalFilePath]);
    if (removeError) {
      console.error("[confirmSubmitDocumentAction] Orphan cleanup failed to delete final file:", removeError);
    }
    return { success: false, error: "Failed to save document. Please try again." };
  }

  const { error: deletePendingError } = await supabase
    .from("pending_document_ocr")
    .delete()
    .eq("id", assessmentId)
    .eq("user_id", user.id);

  if (deletePendingError) {
    console.error("[confirmSubmitDocumentAction] Failed to delete consumed pending OCR row:", deletePendingError);
  }

  const { error: removePendingFileError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .remove([pendingRow.file_path]);

  if (removePendingFileError) {
    console.error("[confirmSubmitDocumentAction] Failed to delete pending file:", removePendingFileError);
  }

  await logEvent(
    supabase,
    user.id,
    SYSTEM_EVENT_TYPES.DOCUMENT_SUBMITTED,
    `Patient submitted document: ${pendingRow.file_name}`,
    null,
    { document_id: docRow.id, file_name: pendingRow.file_name, assessment_id: assessmentId }
  );

  revalidatePath("/patient/submissions");
  revalidatePath("/patient/dashboard");

  return { success: true };
}

export async function discardAssessedDocumentAction(assessmentId: string) {
  // Standing Rule 1: supabase.auth.getUser() first line
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized: Please log in." };
  }

  if (!validateAssessmentId(assessmentId)) {
    return { success: false, error: "Invalid document assessment reference." };
  }

  const { data: pendingRow } = await supabase
    .from("pending_document_ocr")
    .select("file_path")
    .eq("id", assessmentId)
    .eq("user_id", user.id)
    .maybeSingle<{ file_path: string }>();

  const { error: deleteError } = await supabase
    .from("pending_document_ocr")
    .delete()
    .eq("id", assessmentId)
    .eq("user_id", user.id);

  if (deleteError) {
    console.error("[discardAssessedDocumentAction] Failed to delete pending OCR row:", deleteError);
    return { success: false, error: "Failed to clear pending document assessment." };
  }

  if (pendingRow?.file_path) {
    const { error: removeError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([pendingRow.file_path]);
    if (removeError) {
      console.error("[discardAssessedDocumentAction] Failed to remove pending file:", removeError);
    }
  }

  return { success: true };
}
