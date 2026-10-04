"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";

export interface AcceptPrivacyResult {
  error?: string;
  success?: boolean;
}

export async function acceptPrivacyAction(): Promise<AcceptPrivacyResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated. Please log in first." };
  }

  // Update profile
  const { error } = await supabase
    .from("profiles")
    .update({ accepted_privacy_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  // Log audit trail event
  await logEvent(
    supabase,
    user.id,
    SYSTEM_EVENT_TYPES.PRIVACY_ACCEPTED,
    `Patient accepted the Republic Act 10173 Data Privacy Agreement`
  );

  return { success: true };
}
