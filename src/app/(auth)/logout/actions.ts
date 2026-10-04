"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";

/**
 * Signs the current user out, logs the logout event, and redirects to /login.
 */
export async function logoutAction(): Promise<never> {
  const supabase = await createClient();
  const reqHeaders = await headers();
  const ipAddress = reqHeaders.get("x-forwarded-for")?.split(",")[0] || null;

  // Retrieve current user session to audit who logged out
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await logEvent(supabase, user.id, SYSTEM_EVENT_TYPES.LOGOUT, "User logged out successfully", ipAddress);
  }

  await supabase.auth.signOut();
  redirect("/login");
}
