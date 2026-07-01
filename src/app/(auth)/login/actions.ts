"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { headers } from "next/headers";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { getTotpFactors } from "@/lib/auth/mfa";

export interface LoginResult {
  error?: string;
  status?: "mfa_required";
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
 * Handles the login process including password verification, MFA verification, and profile validation.
 */
export async function loginAction(
  prevState: LoginResult | null,
  formData: FormData
): Promise<LoginResult> {
  try {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const totpCode = formData.get("totpCode") as string;

    if (!email || !password) {
      return { error: "Email and password are required." };
    }

    const supabase = createClient();
    const reqHeaders = headers();
    const ipAddress = reqHeaders.get("x-forwarded-for")?.split(",")[0] || null;

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
      return { error: getSafeAuthErrorMessage(authError.message) };
    }

    const user = authData.user;
    if (!user) {
      return { error: "Authentication failed. No user record found." };
    }

    // 2. Fetch the profile details
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("is_active, role, department, full_name")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      await supabase.auth.signOut();
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
      return { error: "Your account is deactivated. Please contact your administrator." };
    }

    // 4. Check if Multi-Factor Authentication (MFA) is required
    const { data: mfaData, error: mfaError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (mfaError || !mfaData) {
      await supabase.auth.signOut();
      return { error: `MFA configuration error: ${mfaError?.message || "No MFA assurance data returned"}` };
    }

    // If MFA is enrolled (nextLevel is aal2) and the user has not completed the second factor (currentLevel is aal1)
    if (mfaData.nextLevel === "aal2" && mfaData.currentLevel === "aal1") {
      // If we didn't receive a TOTP code, prompt the user for it
      if (!totpCode) {
        return {
          status: "mfa_required",
        };
      }

      // List user factors to find TOTP factor ID
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError || !factors) {
        await supabase.auth.signOut();
        return { error: `Failed to retrieve MFA factors: ${factorsError?.message || "Unknown error"}` };
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
        return { error: `MFA challenge failed: ${challengeError?.message || "Failed to create challenge"}` };
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
        return { error: "Invalid verification code. Please try again." };
      }
    }

    // 5. Successful login audit log
    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.LOGIN_SUCCESS,
      `User ${profile.full_name} (${profile.role}) successfully logged in`,
      ipAddress
    );

    // 6. Return success and route destination
    let redirectUrl = "/patient/dashboard";
    if (profile.role === "admin") redirectUrl = "/admin/dashboard";
    else if (profile.role === "receptionist") redirectUrl = "/reception/dashboard";
    else if (profile.role === "department_staff") redirectUrl = "/department/dashboard";
    else if (profile.role === "medical_specialist") redirectUrl = "/specialist/dashboard";

    return { success: true, redirectUrl };
  } catch (err) {
    console.error("Login action unexpected error:", err);
    return { error: "An unexpected sign-in error occurred. Please try again." };
  }
}
