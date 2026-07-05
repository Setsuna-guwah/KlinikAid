"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

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

  // Derive origin dynamically for redirect URL
  const reqHeaders = headers();
  const host = reqHeaders.get("host") || "klinik-aid.vercel.app";
  const protocol = host.includes("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  const supabase = createClient();

  try {
    // Send password reset email
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset-password`,
    });
  } catch (err) {
    console.error("Forgot password API error:", err);
  }

  // Anti-enumeration: always return success to caller
  return { success: true };
}
