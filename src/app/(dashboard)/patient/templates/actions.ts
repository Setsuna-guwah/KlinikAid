"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { validateAge } from "@/lib/validation";

export interface TemplateSubmitResult {
  success: boolean;
  error?: string;
  documentId?: string;
}

export async function submitTemplateDocumentAction(
  templateId: string,
  templateName: string,
  fieldsPayload: Record<string, string>
): Promise<TemplateSubmitResult> {
  const supabase = createClient();

  try {
    // 1. Authenticate patient session (Rule 1 & Rule 9)
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Unauthorized: Please log in." };
    }

    // 2. Get corresponding patient record along with profile information
    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("id, first_name, last_name, date_of_birth, contact_number, address")
      .eq("profile_id", user.id)
      .single();

    if (patientError || !patient) {
      return { success: false, error: "Patient profile is not configured. Contact clinic staff." };
    }

    const patientDob = patient.date_of_birth || "";
    const fullName = `${patient.first_name || ""} ${patient.last_name || ""}`.trim();

    // Server-side age validation for intake forms
    if (templateId === "patient-intake") {
      const ageValidation = validateAge(patientDob);
      if (!ageValidation.valid) {
        return {
          success: false,
          error: ageValidation.error || "Submission restricted: age must be 18 or above."
        };
      }
    }

    // 3. Format dynamic file details
    const timestamp = Date.now();
    const formattedDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit"
    });
    
    const fileName = `${templateName} - ${formattedDate}`;
    const filePath = `template://${templateId}-${timestamp}`;

    // Combine payload for extracted_metadata and force-inject authenticated user credentials
    const extractedMetadata = {
      ...fieldsPayload,
      patient_name: fullName,
      ...(templateId === "patient-intake" ? {
        date_of_birth: patientDob,
        contact_number: patient.contact_number || "",
        address: patient.address || ""
      } : {}),
      template_id: templateId,
      template_name: templateName,
      submission_type: "template",
      submitted_at: new Date().toISOString()
    };

    // 4. Save into documents table
    const { data: docRow, error: insertError } = await supabase
      .from("documents")
      .insert({
        patient_id: patient.id,
        uploader_id: user.id,
        file_name: fileName,
        file_path: filePath,
        file_type: "template",
        status: "pending",
        extracted_metadata: extractedMetadata
      })
      .select("id")
      .single();

    if (insertError) {
      throw insertError;
    }

    // 5. Audit event logging (no PII in metadata)
    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.DOCUMENT_SUBMITTED,
      `Patient submitted form template: ${templateName}`,
      null,
      { document_id: docRow.id }
    );

    revalidatePath("/patient/submissions");
    return { success: true, documentId: docRow.id };
  } catch (err: unknown) {
    console.error("Failed to submit form template:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to submit form template."
    };
  }
}

