"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { headers } from "next/headers";
import { after } from "next/server";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { getTotpFactors } from "@/lib/auth/mfa";
import { getDefaultLandingPath } from "@/lib/auth/helpers";
import { sendEmailConfirmation } from "@/lib/auth/email-confirmation";
import { SET_PASSWORD_PATH, mustChangePassword } from "@/lib/auth/temporary-password";
import {
  beginLoginAttempt,
  claimTotpCode,
  clearLoginAttempts,
  lockedOutMessage,
  refundLoginAttempt,
  type TotpClaim,
} from "@/lib/auth/login-attempts";

const LIMITER_UNAVAILABLE = "Sign-in is temporarily unavailable. Please try again shortly.";
const DEACTIVATED_MESSAGE = "Your account is deactivated. Please contact your administrator.";

export interface LoginResult {
  error?: string;
  status?: "mfa_required" | "email_unconfirmed";
  success?: boolean;
  redirectUrl?: string;
}

function isNetworkAuthError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("network") ||
    normalized.includes("timeout") ||
    normalized.includes("connect")
  );
}

function getSafeAuthErrorMessage(message: string): string {
  if (isNetworkAuthError(message)) {
    return "Unable to reach the authentication service. Please check your connection and try again.";
  }

  return message;
}

/**
 * Runs a write the sign-in reply does not wait for, once the reply has been sent.
 * The helpers it calls already log their own failures; this is the backstop for
 * anything that still throws, so the failure is logged rather than dropped.
 */
function runAfterResponse(description: string, write: () => Promise<unknown>): void {
  after(async () => {
    try {
      await write();
    } catch (err) {
      console.error(`Login: ${description} failed after the response:`, err);
    }
  });
}

/**
 * Handles the login process including password verification, MFA verification, and profile validation.
 */
export async function loginAction(
  prevState: LoginResult | null,
  formData: FormData
): Promise<LoginResult> {
  try {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const totpCode = ((formData.get("totpCode") as string | null) ?? "").replace(/\s+/g, "");

    if (!email || !password) {
      return { error: "Email and password are required." };
    }

    const supabase = await createClient();
    const reqHeaders = await headers();
    const ipAddress = reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

    // 0. Count this submission against (email, IP) before the password is
    // checked: the code step re-submits the password too, so this one counter
    // limits password guesses and TOTP guesses alike (#59).
    const gate = await beginLoginAttempt(email, ipAddress);
    if (gate.kind === "failed") {
      console.error("Login attempt limiter unavailable:", gate.error);
      return { error: LIMITER_UNAVAILABLE };
    }
    if (gate.kind === "locked") {
      await logEvent(
        supabase,
        null,
        SYSTEM_EVENT_TYPES.LOGIN_FAILED,
        `Sign-in refused for email: ${email} - too many attempts from this address`,
        ipAddress,
        { reason: "locked_out", retry_after: gate.retryAfter.toISOString() }
      );
      return { error: lockedOutMessage(gate.retryAfter) };
    }

    // 1. Authenticate with password
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      // Log failed password login attempt
      await logEvent(
        supabase,
        null,
        SYSTEM_EVENT_TYPES.LOGIN_FAILED,
        `Failed password login attempt for email: ${email} - ${authError.message}`,
        ipAddress
      );
      // Auth only says this after the password matched, so it reveals nothing new.
      if (authError.code === "email_not_confirmed") {
        return {
          status: "email_unconfirmed",
          error: "Confirm your email address before signing in. Open the link we emailed you, or send a new one.",
        };
      }
      // Deactivation bans the Auth user, so Auth refuses before the profile
      // check in step 3 can run. Same message that check would have shown.
      if (authError.code === "user_banned") {
        return { error: DEACTIVATED_MESSAGE };
      }
      return { error: getSafeAuthErrorMessage(authError.message) };
    }

    const user = authData.user;
    if (!user) {
      return { error: "Authentication failed. No user record found." };
    }

    // 2-4. The profile, the assurance level and, when a code was submitted, the
    // factor list all read the user the password just signed in. None of them
    // needs another's answer, so they run together. Each result is still checked
    // below in the original order before anything is decided.
    const [profileRead, mfaRead, factorsRead] = await Promise.all([
      supabase
        .from("profiles")
        .select("is_active, role, department, full_name")
        .eq("id", user.id)
        .single(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      totpCode ? supabase.auth.mfa.listFactors() : null,
    ]);

    // 2. Fetch the profile details
    const { data: profile, error: profileError } = profileRead;

    if (profileError || !profile) {
      await supabase.auth.signOut();
      // user_id stays null: it references profiles(id), and the missing profile
      // row is the event being recorded, so the auth id goes in metadata.
      await logEvent(
        supabase,
        null,
        SYSTEM_EVENT_TYPES.LOGIN_FAILED,
        `Password accepted for ${email} but no readable profile row was found`,
        ipAddress,
        { auth_user_id: user.id, profile_error: profileError?.code ?? null }
      );
      return { error: "User profile not found. Please contact your administrator." };
    }

    // 3. Check if account is active
    if (!profile.is_active) {
      await supabase.auth.signOut();
      await logEvent(
        supabase,
        user.id,
        SYSTEM_EVENT_TYPES.LOGIN_FAILED,
        `Inactive user ${profile.full_name} (${email}) attempted login`,
        ipAddress
      );
      return { error: DEACTIVATED_MESSAGE };
    }

    // 4. Check if Multi-Factor Authentication (MFA) is required
    const { data: mfaData, error: mfaError } = mfaRead;

    if (mfaError || !mfaData) {
      await supabase.auth.signOut();
      return {
        error: mfaError?.code === "user_banned"
          ? DEACTIVATED_MESSAGE
          : `MFA configuration error: ${mfaError?.message || "No MFA assurance data returned"}`,
      };
    }

    // The replay claim is started only once GoTrue has accepted the code.
    let totpClaim: Promise<TotpClaim> | null = null;

    // If MFA is enrolled (nextLevel is aal2) and the user has not completed the second factor (currentLevel is aal1)
    if (mfaData.nextLevel === "aal2" && mfaData.currentLevel === "aal1") {
      // If we didn't receive a TOTP code, prompt the user for it
      if (!totpCode) {
        // Reaching the code prompt proved the password; don't let it use up
        // one of the user's code attempts. The reply does not wait for the refund.
        runAfterResponse("refunding the login attempt", () => refundLoginAttempt(email, ipAddress));
        return {
          status: "mfa_required",
        };
      }

      // The factor list was requested because a code was submitted, so it is
      // present here. A missing read takes the failure branch below.
      const { data: factors, error: factorsError } = factorsRead ?? { data: null, error: null };
      if (factorsError || !factors) {
        await supabase.auth.signOut();
        return {
          error: factorsError?.code === "user_banned"
            ? DEACTIVATED_MESSAGE
            : `Failed to retrieve MFA factors: ${factorsError?.message || "Unknown error"}`,
        };
      }

      const totpFactor = getTotpFactors(factors).find((factor) => factor.status === "verified");
      if (!totpFactor) {
        await supabase.auth.signOut();
        return { error: "Verified MFA factor not found on account." };
      }

      // Create challenge
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: totpFactor.id,
      });

      if (challengeError || !challenge) {
        await supabase.auth.signOut();
        return {
          error: challengeError?.code === "user_banned"
            ? DEACTIVATED_MESSAGE
            : `MFA challenge failed: ${challengeError?.message || "Failed to create challenge"}`,
        };
      }

      // Verify challenge
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totpFactor.id,
        challengeId: challenge.id,
        code: totpCode,
      });

      if (verifyError) {
        await supabase.auth.signOut();
        await logEvent(
          supabase,
          user.id,
          SYSTEM_EVENT_TYPES.LOGIN_FAILED,
          `MFA code verification failed for user ${profile.full_name}`,
          ipAddress
        );
        return {
          error: verifyError.code === "user_banned"
            ? DEACTIVATED_MESSAGE
            : "Invalid verification code. Please try again.",
        };
      }

      // GoTrue accepts a code for as long as its window lasts, however many
      // times it is presented. Record it so it completes one sign-in only.
      totpClaim = claimTotpCode(totpFactor.id, totpCode);
    }

    // The replay claim decides whether this sign-in is accepted; the landing
    // path only says where an accepted sign-in goes. Neither needs the other.
    const [claim, redirectUrl] = await Promise.all([
      totpClaim,
      // 5. Return success and route destination
      mustChangePassword(user) ? SET_PASSWORD_PATH : getDefaultLandingPath(user.id, profile),
    ]);

    if (claim && claim.kind !== "claimed") {
      await supabase.auth.signOut();
      if (claim.kind === "failed") {
        console.error("TOTP replay check unavailable:", claim.error);
        return { error: LIMITER_UNAVAILABLE };
      }
      await logEvent(
        supabase,
        user.id,
        SYSTEM_EVENT_TYPES.LOGIN_FAILED,
        `Reused MFA code rejected for user ${profile.full_name}`,
        ipAddress,
        { reason: "totp_replay" }
      );
      return { error: "That code has already been used. Wait for the next code and try again." };
    }

    // Neither the counter reset nor the success audit row is in the reply, so
    // both are written after it is sent.
    runAfterResponse("clearing login attempts", () => clearLoginAttempts(email, ipAddress));
    runAfterResponse("the login audit row", () =>
      logEvent(
        supabase,
        user.id,
        SYSTEM_EVENT_TYPES.LOGIN_SUCCESS,
        `User ${profile.full_name} (${profile.role}) successfully logged in`,
        ipAddress
      )
    );

    return { success: true, redirectUrl };
  } catch (err) {
    console.error("Login action unexpected error:", err);
    return { error: "An unexpected sign-in error occurred. Please try again." };
  }
}

/**
 * Sends a new signup confirmation link. The answer is the same whatever the
 * address, so it cannot be used to test which addresses have accounts.
 */
export async function resendConfirmationAction(email: string): Promise<{ message: string }> {
  if (email) {
    await sendEmailConfirmation(await createClient(), email);
  }
  return {
    message: "If this address has an unconfirmed account, a new confirmation link is on its way.",
  };
}
