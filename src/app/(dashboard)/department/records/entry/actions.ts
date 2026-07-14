"use server";

import { requireRole } from "@/lib/auth/helpers";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { extractDocumentText } from "@/lib/documents/extractDocumentText";
import { logEvent } from "@/lib/logger";
import { extractLabResultValues } from "@/lib/records/extractLabResultValues";
import { createClient } from "@/lib/supabase/server";

const MAX_LAB_OCR_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_LAB_OCR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);
const FREE_TEXT_OCR_DEPARTMENTS = new Set(["imaging", "ultrasound", "ecg"]);
const FREE_TEXT_OCR_TARGETS = new Set(["findings", "impression"]);
const OCR_FAILURE_PHRASES = [
  "cannot extract",
  "unable to extract",
  "too blurry",
  "cannot read",
  "unable to read",
  "illegible",
  "i am sorry",
  "no text",
];

export interface ExtractLabResultValuesActionResult {
  success: boolean;
  error?: string;
  panel?: string | null;
  values?: Record<string, string>;
}

export interface ExtractDepartmentTextActionResult {
  success: boolean;
  error?: string;
  text?: string;
}

function isUnreadableOcrText(text: string | null | undefined) {
  const normalized = (text || "").trim().toLowerCase();
  if (!normalized || normalized === "ocr_failed") return true;
  return OCR_FAILURE_PHRASES.some((phrase) => normalized.includes(phrase));
}

export async function extractLabResultValuesAction(
  formData: FormData
): Promise<ExtractLabResultValuesActionResult> {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const profile = await requireRole(["admin", "department_staff"]);
    const effectiveDepartment =
      profile.role === "department_staff"
        ? profile.department
        : String(formData.get("department") || "laboratory");

    if (effectiveDepartment !== "laboratory") {
      return { success: false, error: "OCR lab value extraction is available only for laboratory records." };
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { success: false, error: "Upload a laboratory result sheet before extracting values." };
    }

    if (!ALLOWED_LAB_OCR_MIME_TYPES.has(file.type)) {
      return { success: false, error: "Only PDF, JPG, or PNG result sheets are supported." };
    }

    if (file.size > MAX_LAB_OCR_FILE_SIZE) {
      return { success: false, error: "Result sheet must be 5MB or smaller." };
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const extractionResult = await extractLabResultValues(fileBuffer, file.type);

    if (!extractionResult) {
      return { success: false, error: "Unable to extract structured lab values from this file." };
    }

    try {
      await logEvent(
        supabase,
        user.id,
        SYSTEM_EVENT_TYPES.LAB_RESULT_OCR_PROCESSED,
        "Lab result values extracted via Google Generative AI",
        null,
        {
          panel: extractionResult.panel,
          extracted_value_count: Object.keys(extractionResult.values).length,
          prompt_token_count: extractionResult.promptTokenCount,
          candidates_token_count: extractionResult.candidatesTokenCount,
          total_token_count: extractionResult.totalTokenCount,
        }
      );
    } catch (logError) {
      console.error("[extractLabResultValuesAction] Non-blocking OCR event logging error:", logError);
    }

    return {
      success: true,
      panel: extractionResult.panel,
      values: extractionResult.values,
    };
  } catch (error) {
    console.error("[extractLabResultValuesAction] Failed to extract lab result values:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to extract lab result values.",
    };
  }
}

export async function extractDepartmentTextAction(
  formData: FormData
): Promise<ExtractDepartmentTextActionResult> {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const profile = await requireRole(["admin", "department_staff"]);
    const effectiveDepartment =
      profile.role === "department_staff"
        ? profile.department
        : String(formData.get("department") || "");
    const targetField = String(formData.get("targetField") || "");

    if (effectiveDepartment === "laboratory") {
      return { success: false, error: "Use lab value OCR for laboratory records." };
    }

    if (!FREE_TEXT_OCR_DEPARTMENTS.has(String(effectiveDepartment))) {
      return {
        success: false,
        error: "Text OCR is available only for Imaging, Ultrasound, and ECG records.",
      };
    }

    if (!FREE_TEXT_OCR_TARGETS.has(targetField)) {
      return { success: false, error: "Select where to place the extracted text." };
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { success: false, error: "Upload a result sheet before extracting text." };
    }

    if (!ALLOWED_LAB_OCR_MIME_TYPES.has(file.type)) {
      return { success: false, error: "Only PDF, JPG, or PNG result sheets are supported." };
    }

    if (file.size > MAX_LAB_OCR_FILE_SIZE) {
      return { success: false, error: "Result sheet must be 5MB or smaller." };
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const extractionResult = await extractDocumentText(fileBuffer, file.type);

    if (!extractionResult) {
      return {
        success: false,
        error: "Unable to extract readable text from this file. Please review the image quality and try again.",
      };
    }

    const extractedText = (extractionResult.text || "").trim();
    const isUnreadable = isUnreadableOcrText(extractedText);

    try {
      await logEvent(
        supabase,
        user.id,
        SYSTEM_EVENT_TYPES.DEPARTMENT_TEXT_OCR_PROCESSED,
        "Department text extracted via Google Generative AI",
        null,
        {
          department: effectiveDepartment,
          target_field: targetField,
          prompt_token_count: extractionResult.promptTokenCount,
          candidates_token_count: extractionResult.candidatesTokenCount,
          total_token_count: extractionResult.totalTokenCount,
          extracted_char_count: isUnreadable ? 0 : extractedText.length,
          extraction_status: isUnreadable ? "unreadable" : "success",
        }
      );
    } catch (logError) {
      console.error("[extractDepartmentTextAction] Non-blocking OCR event logging error:", logError);
    }

    if (isUnreadable) {
      return {
        success: false,
        error: "Could not extract readable text from this file. Upload a clearer image or enter the text manually.",
      };
    }

    return {
      success: true,
      text: extractedText,
    };
  } catch (error) {
    console.error("[extractDepartmentTextAction] Failed to extract department text:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to extract department text.",
    };
  }
}
