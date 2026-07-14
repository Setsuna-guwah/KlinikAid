"use server";

import { requireRole } from "@/lib/auth/helpers";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { logEvent } from "@/lib/logger";
import { extractLabResultValues } from "@/lib/records/extractLabResultValues";
import { createClient } from "@/lib/supabase/server";

const MAX_LAB_OCR_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_LAB_OCR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

export interface ExtractLabResultValuesActionResult {
  success: boolean;
  error?: string;
  panel?: string | null;
  values?: Record<string, string>;
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
