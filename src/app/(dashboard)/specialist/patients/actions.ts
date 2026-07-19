"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { revalidatePath } from "next/cache";
import { CONTACT_REQUIREMENT_TEXT, validateContactNumber, validateName } from "@/lib/validation";
import { z } from "zod";

export interface SpecialistPatientResult {
  success: boolean;
  error?: string;
  patientId?: string;
}

const DOB_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const genderSchema = z.enum(["male", "female", "other"]);
const optionalEmailSchema = z.string().email("Invalid email address");

function getTodayInPh(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
  };
}

function validateSpecialistPatientDob(dobString: string): { valid: boolean; error?: string } {
  const match = DOB_REGEX.exec(dobString);
  if (!match) {
    return { valid: false, error: "Invalid date of birth format." };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dob = new Date(Date.UTC(year, month - 1, day));

  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) {
    return { valid: false, error: "Invalid date of birth." };
  }

  const today = getTodayInPh();
  const isFuture =
    year > today.year ||
    (year === today.year && month > today.month) ||
    (year === today.year && month === today.month && day > today.day);

  if (isFuture) {
    return { valid: false, error: "Date of birth cannot be in the future." };
  }

  return { valid: true };
}

export async function createSpecialistPatientAction(
  prevState: unknown,
  formData: FormData
): Promise<SpecialistPatientResult> {
  const supabase = createClient();

  try {
    const profile = await requirePermission("specialist.patients");
    
    const firstName = ((formData.get("firstName") as string) || "").trim();
    const lastName = ((formData.get("lastName") as string) || "").trim();
    const dob = ((formData.get("dob") as string) || "").trim();
    const gender = ((formData.get("gender") as string) || "").trim();
    const contactNumber = ((formData.get("contactNumber") as string) || "").trim();
    const email = ((formData.get("email") as string) || "").trim();
    const address = ((formData.get("address") as string) || "").trim();

    if (!firstName || !lastName || !dob || !gender) {
      return { success: false, error: "Missing required patient fields: First Name, Last Name, Date of Birth, Gender" };
    }

    const firstNameCheck = validateName(firstName, "First name");
    if (!firstNameCheck.valid) {
      return { success: false, error: firstNameCheck.error || "Invalid first name." };
    }

    const lastNameCheck = validateName(lastName, "Last name");
    if (!lastNameCheck.valid) {
      return { success: false, error: lastNameCheck.error || "Invalid last name." };
    }

    const dobCheck = validateSpecialistPatientDob(dob);
    if (!dobCheck.valid) {
      return { success: false, error: dobCheck.error || "Invalid date of birth." };
    }

    if (!genderSchema.safeParse(gender).success) {
      return { success: false, error: "Select a valid gender" };
    }

    if (contactNumber) {
      const contactCheck = validateContactNumber(contactNumber);
      if (!contactCheck.valid) {
        return { success: false, error: contactCheck.error || CONTACT_REQUIREMENT_TEXT };
      }
    }

    if (email && !optionalEmailSchema.safeParse(email).success) {
      return { success: false, error: "Invalid email address" };
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
    await requirePermission("specialist.patients");

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
