"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/helpers";
import { SITE_ORIGIN } from "@/lib/constants";

export async function sendStaffResetEmailAction(email: string) {
  try {
    await requireRole(["admin"]);

    if (!email || !email.includes("@")) {
      return { success: false, error: "Invalid email address." };
    }

    // Use server client to trigger recovery email flow
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${SITE_ORIGIN}/reset-password`,
    });

    if (error) {
      throw error;
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send reset link.",
    };
  }
}
