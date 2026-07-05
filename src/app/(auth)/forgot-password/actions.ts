"use server";

import { createClient } from "@/lib/supabase/server";
import { SITE_ORIGIN } from "@/lib/constants";

export interface ForgotPasswordResult {
  success: boolean;
  error?: string;
}

export async function forgotPasswordAction(
  prevState: ForgotPasswordResult | null,
  formData: FormData
): Promise<ForgotPasswordResult> {
  const email = formData.get("email") as string;

  if (!email || !email.includes("@")) {
    return { success: false, error: "Please enter a valid email address." };
  }

  const supabase = createClient();

  try {
    // Send password reset email
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${SITE_ORIGIN}/reset-password`,
    });
  } catch (err) {
    console.error("Forgot password API error:", err);
  }

  // Anti-enumeration: always return success to caller
  return { success: true };
}
