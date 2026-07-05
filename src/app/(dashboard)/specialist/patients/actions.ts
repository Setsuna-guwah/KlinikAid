"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/helpers";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { revalidatePath } from "next/cache";

export interface SpecialistPatientResult {
  success: boolean;
  error?: string;
  patientId?: string;
}

export async function createSpecialistPatientAction(
  prevState: unknown,
  formData: FormData
): Promise<SpecialistPatientResult> {
  const supabase = createClient();

  try {
    const profile = await requireRole(["medical_specialist"]);
    
    const firstName = formData.get("firstName") as string;
    const lastName = formData.get("lastName") as string;
    const dob = formData.get("dob") as string;
    const gender = formData.get("gender") as string;
    const contactNumber = formData.get("contactNumber") as string;
    const email = formData.get("email") as string;
    const address = formData.get("address") as string;

    if (!firstName || !lastName || !dob || !gender) {
      return { success: false, error: "Missing required patient fields: First Name, Last Name, Date of Birth, Gender" };
    }

    const { data: newPatient, error: insertError } = await supabase
      .from("specialist_patients")
      .insert({
        specialist_id: profile.id,
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dob,
        gender,
        contact_number: contactNumber || null,
        email: email || null,
        address: address || null,
      })
      .select("id")
      .single();

    if (insertError) {
      throw insertError;
    }

    // Log administrative audit event (no PII in metadata)
    await logEvent(
      supabase,
      profile.id,
      SYSTEM_EVENT_TYPES.SPECIALIST_PATIENT_CREATED,
      "Specialist created a private patient record",
      null,
      { patient_id: newPatient.id }
    );

    revalidatePath("/specialist/patients");
    return { success: true, patientId: newPatient.id };
  } catch (err: unknown) {
    console.error("Failed to create specialist patient:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create patient.",
    };
  }
}

export async function deleteSpecialistPatientAction(patientId: string): Promise<SpecialistPatientResult> {
  const supabase = createClient();

  try {
    await requireRole(["medical_specialist"]);

    if (!patientId) {
      return { success: false, error: "Patient ID is required." };
    }

    const { error: deleteError } = await supabase
      .from("specialist_patients")
      .delete()
      .eq("id", patientId);

    if (deleteError) {
      throw deleteError;
    }

    revalidatePath("/specialist/patients");
    return { success: true };
  } catch (err: unknown) {
    console.error("Failed to delete specialist patient:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete patient.",
    };
  }
}
