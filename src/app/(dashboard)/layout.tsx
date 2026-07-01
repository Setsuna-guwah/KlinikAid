import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardLayoutClient from "@/components/DashboardLayoutClient";
import { headers } from "next/headers";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { getTotpFactors } from "@/lib/auth/mfa";

export const dynamic = "force-dynamic";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Shared dashboard layout containing the Sidebar and main scrollable content area.
 * Validates user authentication and account status on the server.
 */
export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const supabase = createClient();

  // 1. Retrieve session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 2. Fetch profile and status
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, department, full_name, is_active, accepted_privacy_at")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    // Session exists but profile is missing
    await supabase.auth.signOut();
    redirect("/login");
  }

  // 3. Prevent inactive accounts from accessing the system
  if (!profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=account_deactivated");
  }

  // 3.5 Enforce Data Privacy Agreement gate (Republic Act 10173) for patients
  if (profile.role === "patient" && !profile.accepted_privacy_at) {
    redirect("/privacy-agreement");
  }

  // 3.7 Enforce MFA Enrollment gate for Staff roles
  const isStaff = ["admin", "receptionist", "department_staff", "medical_specialist"].includes(profile.role);
  if (isStaff) {
    const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) {
      console.error("MFA Gate error retrieving factors:", factorsError.message);
      await supabase.auth.signOut();
      redirect("/login?error=mfa_check_failed");
    }

    const hasVerifiedFactor = getTotpFactors(factorsData).some((f) => f.status === "verified");
    if (!hasVerifiedFactor) {
      // Staff has no verified TOTP factor, force routing to enroll page
      redirect("/mfa-enroll");
    }
  }

  // 4. Handle access denial logging and redirection (Revision B)
  const reqHeaders = headers();
  const xPathname = reqHeaders.get("x-pathname") || "";

  if (!xPathname) {
    redirect("/403");
  }

  const isAdminRoute = xPathname.startsWith("/admin");
  const isReceptionRoute = xPathname.startsWith("/reception");
  const isDepartmentRoute = xPathname.startsWith("/department");
  const isSpecialistRoute = xPathname.startsWith("/specialist");
  const isPatientRoute = xPathname.startsWith("/patient");

  let isRoleMismatch = false;
  if (isAdminRoute && profile.role !== "admin") isRoleMismatch = true;
  if (isReceptionRoute && profile.role !== "admin" && profile.role !== "receptionist") isRoleMismatch = true;
  if (isDepartmentRoute && profile.role !== "admin" && profile.role !== "department_staff") isRoleMismatch = true;
  if (isSpecialistRoute && profile.role !== "admin" && profile.role !== "medical_specialist") isRoleMismatch = true;
  if (isPatientRoute && profile.role !== "patient") isRoleMismatch = true;

  if (isRoleMismatch) {
    const ipAddress = reqHeaders.get("x-forwarded-for")?.split(",")[0] || null;
    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.ACCESS_DENIED,
      `Unauthorized access attempt by user ${profile.full_name} (${profile.role}) to path: ${xPathname}`,
      ipAddress,
      { attempted_path: xPathname, user_role: profile.role }
    );
    redirect("/403");
  }

  const sidebarUser = {
    id: profile.id,
    email: user.email || "",
    fullName: profile.full_name,
    role: profile.role,
    department: profile.department,
  };

  return (
    <DashboardLayoutClient user={sidebarUser}>
      {children}
    </DashboardLayoutClient>
  );
}
