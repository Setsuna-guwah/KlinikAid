"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { headers } from "next/headers";

export interface ChangePasswordResult {
  success: boolean;
  error?: string;
}

export async function changePasswordAction(
  prevState: ChangePasswordResult | null,
  formData: FormData
): Promise<ChangePasswordResult> {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!password || password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters long." };
  }

  if (password !== confirmPassword) {
    return { success: false, error: "Passwords do not match." };
  }

  const supabase = createClient();

  // 1. Get active session user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized. Please log in again." };
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
