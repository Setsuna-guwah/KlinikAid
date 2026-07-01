import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MfaEnrollClient from "./MfaEnrollClient";
import { getTotpFactors } from "@/lib/auth/mfa";

export const dynamic = "force-dynamic";

export default async function MfaEnrollPage() {
  const supabase = createClient();

  // 1. Get current authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/login");
  }

  // 2. Fetch user profile
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    redirect("/login");
  }

  // 3. Kick out deactivated accounts
  if (!profile.is_active) {
    redirect("/login?error=account_deactivated");
  }

  // 4. Patients are excluded from MFA requirements
  if (profile.role === "patient") {
    redirect("/patient/dashboard");
  }

  // 5. Check if they already have a verified factor
  const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) {
    console.error("[MFA Page] Failed to fetch factors:", factorsError.message);
  } else if (factorsData) {
    const hasVerifiedTotp = getTotpFactors(factorsData).some((f) => f.status === "verified");
    if (hasVerifiedTotp) {
      // User is already enrolled, bypass page
      let redirectUrl = "/patient/dashboard";
      if (profile.role === "admin") redirectUrl = "/admin/dashboard";
      else if (profile.role === "receptionist") redirectUrl = "/reception/dashboard";
      else if (profile.role === "department_staff") redirectUrl = "/department/dashboard";
      else if (profile.role === "medical_specialist") redirectUrl = "/specialist/dashboard";
      redirect(redirectUrl);
    }
  }

  return <MfaEnrollClient />;
}
