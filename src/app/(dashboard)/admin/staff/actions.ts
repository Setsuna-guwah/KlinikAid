"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/helpers";
import { headers } from "next/headers";

export async function sendStaffResetEmailAction(email: string) {
  try {
    await requireRole(["admin"]);

    if (!email || !email.includes("@")) {
      return { success: false, error: "Invalid email address." };
    }

    const reqHeaders = headers();
    const host = reqHeaders.get("host") || "klinik-aid.vercel.app";
    const protocol = host.includes("localhost") ? "http" : "https";
    const origin = `${protocol}://${host}`;

    // Use server client to trigger recovery email flow
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset-password`,
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
