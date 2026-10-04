"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { getTotpFactors } from "@/lib/auth/mfa";
import { headers } from "next/headers";

export async function verifyMfaFactorAction(factorId: string, code: string) {
  const supabase = await createClient();
  const reqHeaders = await headers();
  const ipAddress = reqHeaders.get("x-forwarded-for")?.split(",")[0] || null;

  // 1. Session check
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: "Unauthorized: Session not found." };
  }

  try {
    // 2. Bind the factor to this account.
    // listFactors only ever returns the caller's own factors, so an id that is
    // not in that list does not belong to this user — previously the id came
    // straight from the request body and was challenged without that check.
    const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) {
      return { error: `Failed to retrieve MFA factors: ${factorsError.message}` };
    }

    const ownedFactor = getTotpFactors(factorsData).find(
      (factor) => factor.id === factorId && factor.status === "verified",
    );

    if (!ownedFactor) {
      await logEvent(
        supabase,
        user.id,
        SYSTEM_EVENT_TYPES.LOGIN_FAILED,
        `MFA enrolment attempted against a factor not owned by this account`,
        ipAddress,
        { factor_id: factorId },
      );
      return { error: "Verification failed: that authenticator is not registered to your account." };
    }

    // 3. Challenge the factor
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: ownedFactor.id,
    });

    if (challengeError || !challenge) {
      return { error: `MFA challenge failed: ${challengeError?.message || "Failed to create challenge"}` };
    }

    // 4. Verify the challenge with the entered code
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: ownedFactor.id,
      challengeId: challenge.id,
      code,
    });

    if (verifyError) {
      return { error: `Invalid verification code. Please try again.` };
    }

    // 4. Retrieve profile name for audit log
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();

    // 5. Emit MFA_ENROLLED system log event only after successful verification
    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.MFA_ENROLLED,
      `User ${profile?.full_name || user.email} successfully enrolled a TOTP MFA factor`,
      ipAddress,
      { factor_id: factorId }
    );

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("MFA Verify Action Exception:", err);
    return { error: message || "An unexpected error occurred during MFA verification." };
  }
}
