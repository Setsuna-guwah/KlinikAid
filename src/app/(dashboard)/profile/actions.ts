"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { PASSWORD_REQUIREMENT_TEXT, validatePassword } from "@/lib/validation";
import { headers } from "next/headers";

export interface ChangePasswordResult {
  success: boolean;
  error?: string;
}

export async function changePasswordAction(
  prevState: ChangePasswordResult | null,
  formData: FormData
): Promise<ChangePasswordResult> {
  const supabase = createClient();

  // 1. Get active session user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized. Please log in again." };
  }

  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!password || !validatePassword(password)) {
    return { success: false, error: PASSWORD_REQUIREMENT_TEXT };
  }

  if (password !== confirmPassword) {
    return { success: false, error: "Passwords do not match." };
  }

  try {
    // 2. Update user password
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // 3. Log the audit event
    const reqHeaders = headers();
    const ipAddress = reqHeaders.get("x-forwarded-for")?.split(",")[0] || null;

    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.PASSWORD_CHANGED,
      "User changed their password via profile settings",
      ipAddress,
      { user_id: user.id }
    );

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to change password.",
    };
  }
}

export interface UpdatePatientDetailsResult {
  success: boolean;
  error?: string;
}

export async function updatePatientDetailsAction(
  prevState: UpdatePatientDetailsResult | null,
  formData: FormData
): Promise<UpdatePatientDetailsResult> {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized. Please log in again." };
  }

  const contactNumber = ((formData.get("contactNumber") as string) || "").trim();
  const address = ((formData.get("address") as string) || "").trim();

  if (!contactNumber) {
    return { success: false, error: "Contact number is required." };
  }

  if (!address) {
    return { success: false, error: "Address is required." };
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { success: false, error: "Unable to verify account profile." };
    }

    if (profile.role !== "patient") {
      return { success: false, error: "Only patient accounts can update patient details here." };
    }

    const { error: updateError } = await supabase
      .from("patients")
      .update({
        contact_number: contactNumber,
        address,
      })
      .eq("profile_id", user.id);

    if (updateError) {
      return { success: false, error: "Unable to update patient details." };
    }

    const reqHeaders = headers();
    const ipAddress = reqHeaders.get("x-forwarded-for")?.split(",")[0] || null;

    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.PROFILE_UPDATED,
      "Patient updated contact details via profile settings",
      ipAddress,
      { user_id: user.id, changed_fields: ["contact_number", "address"] }
    );

    return { success: true };
  } catch {
    return { success: false, error: "Failed to update patient details." };
  }
}
