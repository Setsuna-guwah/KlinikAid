"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { validateAge } from "@/lib/validation";
import { CLINIC_TEMPLATES, type TemplateField } from "@/lib/documentTemplates";

export interface TemplateSubmitResult {
  success: boolean;
  error?: string;
  documentId?: string;
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateTemplateFields(
  fields: TemplateField[],
  payload: Record<string, string>
): { valid: true; fields: Record<string, string> } | { valid: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, error: "Invalid template payload." };
  }

  const allowedKeys = new Set(fields.map((field) => field.key));
  const unexpectedKey = Object.keys(payload).find((key) => !allowedKeys.has(key));

  if (unexpectedKey) {
    return { valid: false, error: `Unexpected field submitted: ${unexpectedKey}.` };
  }

  const normalizedFields: Record<string, string> = {};

  for (const field of fields) {
    const rawValue = payload[field.key];
    const value = typeof rawValue === "string" ? rawValue.trim() : "";

    if (field.required && value === "") {
      return { valid: false, error: `${field.label} is required.` };
    }

    if (value === "") {
      normalizedFields[field.key] = "";
      continue;
    }

    const fieldValidation = validateTemplateFieldValue(field, value);
    if (!fieldValidation.valid) {
      return fieldValidation;
    }

    normalizedFields[field.key] = value;
  }

  return { valid: true, fields: normalizedFields };
}

function validateTemplateFieldValue(
  field: TemplateField,
  value: string
): { valid: true } | { valid: false; error: string } {
  if (field.type === "date" && !isValidDateString(value)) {
    return { valid: false, error: `${field.label} must be a valid date.` };
  }

  if (field.type === "select" && !field.options?.includes(value)) {
    return { valid: false, error: `${field.label} must be one of the allowed options.` };
  }

  return { valid: true };
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

    const template = CLINIC_TEMPLATES.find((item) => item.id === templateId);
    if (!template) {
      return { success: false, error: "Unknown template selected." };
    }

    const fieldsValidation = validateTemplateFields(template.fields, fieldsPayload);
    if (!fieldsValidation.valid) {
      return { success: false, error: fieldsValidation.error };
    }

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
    
    const fileName = `${template.name} - ${formattedDate}`;
    const filePath = `template://${templateId}-${timestamp}`;

    // Combine payload for extracted_metadata and force-inject authenticated user credentials
    const extractedMetadata = {
      ...fieldsValidation.fields,
      patient_name: fullName,
      ...(templateId === "patient-intake" ? {
        date_of_birth: patientDob,
        contact_number: patient.contact_number || "",
        address: patient.address || ""
      } : {}),
      template_id: templateId,
      template_name: template.name,
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
      `Patient submitted form template: ${template.name}`,
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
