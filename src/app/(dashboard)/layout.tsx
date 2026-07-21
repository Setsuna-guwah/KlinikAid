import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardLayoutClient from "@/components/DashboardLayoutClient";
import { headers } from "next/headers";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { getTotpFactors } from "@/lib/auth/mfa";
import { hasAnyPermission, hasPermission } from "@/lib/auth/helpers";
import { NavItem } from "@/components/sidebar";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("id, role, role_id, department, full_name, is_active, accepted_privacy_at")
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
  if (isAdminRoute) {
    isRoleMismatch = !(await hasAnyPermission(user.id, [
      "staff.manage",
      "roles.manage",
      "profiles.manage",
      "system_logs.read",
      "chatbot_logs.read",
      "rag_documents.manage",
    ]));
  }
  if (isReceptionRoute) {
    isRoleMismatch = !(await hasAnyPermission(user.id, [
      "patients.manage",
      "documents.manage",
      "queue.manage",
    ]));
  }
  if (isDepartmentRoute) {
    isRoleMismatch = !(await hasAnyPermission(user.id, [
      "queue.manage",
      "queue.manage.own_dept",
      "records.manage",
      "records.manage.own_dept",
    ]));
  }
  if (isSpecialistRoute) {
    isRoleMismatch = !(await hasAnyPermission(user.id, [
      "specialist.patients",
      "specialist.analytics",
      "specialist.records",
    ]));
  }
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

  let roleName: string | null = null;
  if (profile.role_id) {
    const adminSupabase = createAdminClient();
    const { data: assignedRole } = await adminSupabase
      .from("roles")
      .select("name")
      .eq("id", profile.role_id)
      .maybeSingle();
    roleName = assignedRole?.name || null;
  }

  const sidebarUser = {
    id: profile.id,
    email: user.email || "",
    fullName: profile.full_name,
    role: profile.role,
    roleName,
    department: profile.department,
  };
  const [
    canManageProfiles,
    canManageStaff,
    canReadRoles,
    canManageDocuments,
    canManageQueue,
    canManagePatients,
    canAccessDepartmentRecords,
    canManageRag,
    canReadSystemLogs,
    canAccessSpecialistPatients,
    canAccessChat,
  ] = await Promise.all([
    hasPermission(user.id, "profiles.manage"),
    hasPermission(user.id, "staff.manage"),
    hasPermission(user.id, "roles.read"),
    hasPermission(user.id, "documents.manage"),
    hasPermission(user.id, "queue.manage"),
    hasPermission(user.id, "patients.manage"),
    hasAnyPermission(user.id, ["queue.manage", "queue.manage.own_dept", "records.manage", "records.manage.own_dept"]),
    hasPermission(user.id, "rag_documents.manage"),
    hasPermission(user.id, "system_logs.read"),
    hasPermission(user.id, "specialist.patients"),
    hasPermission(user.id, "chat.access"),
  ]);

  const navItems: NavItem[] = [];

  if (profile.role === "admin" && canManageProfiles) {
    navItems.push({ label: "Dashboard", href: "/admin/dashboard", icon: "LayoutDashboard" });
  }
  if (canManageStaff) {
    navItems.push({ label: "Staff Management", href: "/admin/staff", icon: "Users" });
  }
  if (canReadRoles) {
    navItems.push({ label: "Role Management", href: "/admin/roles", icon: "ShieldCheck" });
  }
  if (canManageDocuments && canManageQueue) {
    navItems.push({ label: "Reception Queue", href: "/reception/queue", icon: "ClipboardList" });
  }
  if (canManagePatients) {
    navItems.push({ label: "Reception Dashboard", href: "/reception/dashboard", icon: "LayoutDashboard" });
  }
  if (canAccessDepartmentRecords) {
    navItems.push({ label: "Dept Records", href: "/department/records", icon: "FileSpreadsheet" });
  }
  if (canManageRag) {
    navItems.push({ label: "RAG Manager", href: "/admin/rag", icon: "Brain" });
  }
  if (canReadSystemLogs) {
    navItems.push({ label: "System Logs", href: "/admin/logs", icon: "History" });
  }
  if (canAccessSpecialistPatients) {
    navItems.push({ label: "Specialist Dashboard", href: "/specialist/dashboard", icon: "LayoutDashboard" });
    navItems.push({ label: "My Patients", href: "/specialist/patients", icon: "UserCheck" });
  }
  if (profile.role === "patient") {
    navItems.push({ label: "Dashboard", href: "/patient/dashboard", icon: "LayoutDashboard" });
    if (canAccessChat) {
      navItems.push({ label: "AI Assistant", href: "/patient/chat", icon: "Bot" });
    }
    navItems.push({ label: "Submit Document", href: "/patient/submit", icon: "Upload" });
    navItems.push({ label: "Document Templates", href: "/patient/templates", icon: "ClipboardList" });
    navItems.push({ label: "Track Submission", href: "/patient/submissions", icon: "Search" });
    navItems.push({ label: "My Results", href: "/patient/results", icon: "FileText" });
  }
  navItems.push({ label: "My Profile", href: "/profile", icon: "User" });

  return (
    <DashboardLayoutClient user={sidebarUser} navItems={navItems}>
      {children}
    </DashboardLayoutClient>
  );
}
