"use server";

import { createClient } from "@/lib/supabase/server";
import { privacyConsentError } from "@/lib/auth/privacy-consent";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/logger";
import { extractDocumentText } from "@/lib/documents/extractDocumentText";
import { detectRequestedTests } from "@/lib/documents/detectRequestedTests";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { timed } from "@/lib/perf/timing";

import { parseUpload, submitUpload, UploadError } from "@/lib/documents/uploadSubmission";
import { uploadStore } from "@/lib/documents/uploadStore";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const DOCUMENT_BUCKET = "patient-documents";
const OCR_FAILURE_TOKEN = "OCR_FAILED";

const OCR_FAILURE_PHRASES = [
  "cannot extract",
  "can't extract",
  "unable to extract",
  "cannot read",
  "can't read",
  "unable to read",
  "i am sorry",
  "i'm sorry",
  "too blurry",
  "blurry",
  "illegible",
  "not legible",
  "no readable text",
  "no text",
];

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

/**
 * Text extraction with failures reported as `null`. A Gemini error must not fail
 * the upload; the caller then treats the file as unreadable, as it always has.
 */
async function extractOcr(fileBuffer: Buffer, mimeType: string) {
  try {
    return await extractDocumentText(fileBuffer, mimeType);
  } catch (ocrError) {
    console.error("[assessDocumentQualityAction] OCR error during quality assessment:", ocrError);
    return null;
  }
}

async function getPatientForCurrentUser(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
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

function isPoorQualityOcrText(text: string) {
  const normalizedText = text.trim().toLowerCase();

  if (!normalizedText) {
    return true;
  }

  if (normalizedText === OCR_FAILURE_TOKEN.toLowerCase()) {
    return true;
  }

  return OCR_FAILURE_PHRASES.some((phrase) => normalizedText.includes(phrase));
}

export async function assessDocumentQualityAction(formData: FormData) {
  // Standing Rule 1: supabase.auth.getUser() first line
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized: Please log in." };
  }

  // The consent gate and the patient lookup are independent reads; run them together.
  const [consentError, { patient, error: patientError }] = await timed("assess: consent + patient", () =>
    Promise.all([privacyConsentError(supabase, user.id), getPatientForCurrentUser(supabase, user.id)])
  );
  if (consentError) {
    return { success: false, error: consentError };
  }

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

  // The stored copy and the text extraction read the same bytes and do not
  // depend on each other. Extraction resolves to null on failure, so only the
  // upload can fail here.
  const [{ error: uploadError }, extractionResult] = await timed("assess: storage upload + OCR", () =>
    Promise.all([
      supabase.storage
        .from(DOCUMENT_BUCKET)
        .upload(pendingFilePath, fileBuffer, {
          contentType: file.type,
          upsert: false,
        }),
      extractOcr(fileBuffer, file.type),
    ])
  );

  if (uploadError) {
    console.error("[assessDocumentQualityAction] Pending file upload error:", uploadError);
    return { success: false, error: `Failed to upload file for assessment: ${uploadError.message}` };
  }

  let ocrText = "";
  let promptTokenCount: number | null = null;
  let candidatesTokenCount: number | null = null;
  let totalTokenCount: number | null = null;

  if (extractionResult) {
    ocrText = extractionResult.text || "";
    promptTokenCount = extractionResult.promptTokenCount;
    candidatesTokenCount = extractionResult.candidatesTokenCount;
    totalTokenCount = extractionResult.totalTokenCount;

    // The audit row is not needed for the patient's next step, so it is written
    // after the response. The guard stays so an unexpected error cannot escape the callback.
    after(async () => {
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
    });
  }

  const isPoorQualityOcr = isPoorQualityOcrText(ocrText);
  const storedOcrText = isPoorQualityOcr ? "" : ocrText;
  const detectedTests = isPoorQualityOcr ? [] : detectRequestedTests(storedOcrText);

  const { error: pendingError } = await timed("assess: pending row insert", () =>
    supabase
      .from("pending_document_ocr")
      .insert({
        id: assessmentId,
        user_id: user.id,
        patient_id: patient.id,
        file_name: file.name,
        file_type: file.type,
        file_path: pendingFilePath,
        ocr_text: storedOcrText,
        prompt_token_count: promptTokenCount,
        candidates_token_count: candidatesTokenCount,
        total_token_count: totalTokenCount,
      })
  );

  if (pendingError) {
    console.error("[assessDocumentQualityAction] Pending OCR insert error:", pendingError);
    await supabase.storage.from(DOCUMENT_BUCKET).remove([pendingFilePath]);
    return { success: false, error: "Failed to save document assessment. Please try again." };
  }

  return {
    success: true,
    assessmentId,
    isOcrTextEmpty: isPoorQualityOcr,
    detectedTests,
  };
}

// The assessment ID was generated by the server in assessDocumentQualityAction.
// It is also the stable web request ID: a repeated confirmation replays, while
// changing a previously accepted selection is a conflict, never another document.
export async function confirmSubmitDocumentAction(assessmentId: string, selectedTestIds?: string[], documentType = "other") {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Please sign in again." };
  const admin = createAdminClient();
  // The consent gate, the profile and the patient lookup are independent reads.
  // They run together and are still checked below in the same order.
  const [consentError, profileRead, patientRead] = await timed("confirm: consent + profile + patient", () =>
    Promise.all([
      privacyConsentError(supabase, user.id),
      admin.from("profiles")
        .select("is_active,roles:role_id(name,is_system,base_role)").eq("id", user.id)
        .maybeSingle<{ is_active: boolean; roles: { name: string; is_system: boolean; base_role: string | null } | null }>(),
      getPatientForCurrentUser(supabase, user.id),
    ])
  );
  if (consentError) return { success: false, error: consentError };
  const { data: profile, error: profileError } = profileRead;
  if (profileError) return { success: false, error: "Submission could not be confirmed. Contact the clinic." };
  if (!profile?.is_active) return { success: false, error: "Account is inactive. Contact the clinic." };
  const role = profile.roles?.is_system ? profile.roles.name : profile.roles?.base_role;
  if (role !== "patient") return { success: false, error: "A patient account is required." };
  if (!user.email_confirmed_at) return { success: false, error: "Please verify your email." };
  if (user.app_metadata.must_change_password === true) return { success: false, error: "Please change your temporary password." };
  const { patient, error: patientError } = patientRead;
  if (!patient) return { success: false, error: patientError ?? "Patient account is incomplete." };
  try {
    const input = parseUpload({ request_id: assessmentId, assessment_id: assessmentId, document_type: documentType,
      ...(selectedTestIds !== undefined ? { selected_test_ids: selectedTestIds } : {}) });
    const result = await timed("confirm: submit upload", () =>
      submitUpload(uploadStore(admin, timed), user.id, patient.id, input, "ocr_text_catalog_match")
    );
    revalidatePath("/patient/submissions");
    revalidatePath("/patient/dashboard");
    return { success: true, documentId: result.document_id };
  } catch (error) {
    if (error instanceof UploadError) {
      const messages: Record<string, string> = {
        FIELD_REQUIRED: "Select at least one detected test. Your file is still available.",
        FIELD_INVALID: "The assessment, file, or selection is invalid. Your file is still available.",
        UNKNOWN_FIELD: "This app version is out of date.",
        ASSESSMENT_NOT_FOUND: "The assessment is unavailable or already used. Contact the clinic.",
        DUPLICATE_PENDING: "You already have a pending document in this category.",
        IDEMPOTENCY_CONFLICT: "Contact the clinic before submitting again. Your selection conflicts with an accepted request.",
        RECONCILIATION_REQUIRED: "Contact the clinic before submitting again.",
        SERVER_ERROR: "We could not confirm this submission. Your file is still here. Try again, or contact the clinic.",
      };
      return { success: false, error: messages[error.code], errorCode: error.code, documentId: error.extra?.document_id };
    }
    return { success: false, error: "We could not confirm this submission. Contact the clinic." };
  }
}
export async function discardAssessedDocumentAction(assessmentId: string) {
  // Standing Rule 1: supabase.auth.getUser() first line
  const supabase = await createClient();
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
