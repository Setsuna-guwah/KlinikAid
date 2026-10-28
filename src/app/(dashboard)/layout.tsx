import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardLayoutClient from "@/components/DashboardLayoutClient";
import { headers } from "next/headers";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { staffMfaStep } from "@/lib/auth/mfa";
import { getDashboardAccess, getProfile, permissionHolder } from "@/lib/auth/helpers";
import { startRequestSession } from "@/lib/auth/session";
import { timed } from "@/lib/perf/timing";
import { NavItem } from "@/components/sidebar";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Permission lists that decide whether a route prefix is reachable at all.
// The sidebar reuses these so a link is never shown to a user the route gate
// would turn away.
const ADMIN_AREA_PERMISSIONS: string[] = [
  "staff.manage",
  "roles.manage",
  "profiles.manage",
  "system_logs.read",
  "chatbot_logs.read",
  "rag_documents.manage",
];
const RECEPTION_AREA_PERMISSIONS: string[] = [
  "patients.manage",
  "documents.manage",
  "queue.manage",
];
const DEPARTMENT_AREA_PERMISSIONS: string[] = [
  "queue.manage",
  "queue.manage.own_dept",
  "records.manage",
  "records.manage.own_dept",
];
const SPECIALIST_AREA_PERMISSIONS: string[] = [
  "specialist.patients",
  "specialist.analytics",
  "specialist.records",
];

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Shared dashboard layout containing the Sidebar and main scrollable content area.
 * Validates user authentication and account status on the server.
 */
export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const supabase = await createClient();

  // 1. Retrieve session and profile.
  //
  // The token's signature is verified locally and the Auth server's answer on
  // whether the session is still live runs alongside it (issues #165, #238).
  // The reads below need only the user id, so they start before that answer
  // arrives; nothing they return is used until `live` confirms the session.
  const pending = await startRequestSession();
  if (!pending) {
    redirect("/login");
  }
  const { user, aal } = pending.session;

  // The role name and permissions need only the user id, so they are asked now
  // and run while the profile row is being read. One call answers both; if it
  // fails, each permission is checked on its own (see getDashboardAccess).
  const accessPromise = getDashboardAccess();
  const permissionsPromise = timed("layout.perms", async () => {
    const holds = permissionHolder(user.id, await accessPromise);
    const anyOf = async (permissionNames: string[]) =>
      (await Promise.all(permissionNames.map(holds))).some(Boolean);

    return Promise.all([
      anyOf(ADMIN_AREA_PERMISSIONS),
      anyOf(RECEPTION_AREA_PERMISSIONS),
      anyOf(DEPARTMENT_AREA_PERMISSIONS),
      anyOf(SPECIALIST_AREA_PERMISSIONS),
      holds("profiles.manage"),
      holds("staff.manage"),
      holds("roles.read"),
      holds("documents.manage"),
      holds("queue.manage"),
      holds("patients.manage"),
      holds("rag_documents.manage"),
      holds("system_logs.read"),
      holds("specialist.patients"),
      holds("chat.access"),
    ]);
  });
  // A request that is turned away below never awaits this promise; the handler
  // keeps a failure from surfacing as an unhandled rejection.
  permissionsPromise.catch(() => {});

  const profilePromise = getProfile(user.id);

  // A session the Auth server no longer recognises (signed out, revoked) is
  // refused before any of the reads above is used.
  if (!(await pending.live)) {
    redirect("/login");
  }

  const profile = await profilePromise;

  if (!profile) {
    // Session exists but profile is missing
    await supabase.auth.signOut();
    redirect("/login");
  }

  // 3. Prevent inactive accounts from accessing the system
  if (!profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=account_deactivated");
  }

  // The role name is only used for the sidebar's label. It comes from the access
  // call above. If that call failed, it is read with the service role instead,
  // because the `roles` table is not readable by every signed-in user. Its error
  // is deliberately not fatal: failing the whole dashboard because a cosmetic
  // label could not resolve would trade a visible defect for an invisible one.
  // Logged so the gap is diagnosable rather than silent.
  const roleNamePromise = (async () => {
    const access = await accessPromise;
    if (access) return access.roleName;
    if (!profile.role_id) return null;
    const adminSupabase = createAdminClient();
    const { data: assignedRole, error: roleError } = await timed("layout.roles.name", () =>
      adminSupabase
        .from("roles")
        .select("name")
        .eq("id", profile.role_id)
        .maybeSingle()
    );
    if (roleError) {
      console.error("Dashboard layout: could not resolve role name for sidebar:", roleError.message);
    }
    return assignedRole?.name || null;
  })();
  // A request that is turned away below never awaits this promise; the handler
  // keeps a failure from surfacing as an unhandled rejection.
  roleNamePromise.catch(() => {});

  // 3.5 Enforce Data Privacy Agreement gate (Republic Act 10173) for patients
  if (profile.role === "patient" && !profile.accepted_privacy_at) {
    redirect("/privacy-agreement");
  }

  // 3.7 Enforce MFA Enrollment gate for Staff roles
  //
  // Factor existence alone is not assurance. A verified factor proves the
  // account CAN use a second factor; only the session's assurance level proves
  // this session DID. Login returns `mfa_required` without signing out, so an
  // AAL1 session survives the prompt and reaches this layout — checking the
  // factor list alone would let a stolen password through. The `aal` claim
  // comes from the verified token, so the factor list is only read when that
  // claim is not aal2 (see staffMfaStep).
  const isStaff = ["admin", "receptionist", "department_staff", "medical_specialist"].includes(profile.role);
  if (isStaff) {
    const step = await staffMfaStep(aal, () =>
      timed("layout.mfa.listFactors", () => supabase.auth.mfa.listFactors())
    );

    if (step === "enroll") {
      // Staff has no verified TOTP factor, force routing to enroll page
      redirect("/mfa-enroll");
    }

    if (step === "mfa_required") {
      // Kick the still-unverified session out entirely rather than bouncing it
      // to the challenge, so the only way back in is a full sign-in.
      await supabase.auth.signOut();
      redirect("/login?error=mfa_required");
    }

    if (step === "check_failed") {
      // A session that cannot describe its own factors cannot be trusted to
      // grant access: fail closed as a redirect, not as a 500 on a blank page.
      await supabase.auth.signOut();
      redirect("/login?error=mfa_check_failed");
    }
  }

  // 4. Handle access denial logging and redirection (Revision B)
  const reqHeaders = await headers();
  const xPathname = reqHeaders.get("x-pathname") || "";

  if (!xPathname) {
    redirect("/403");
  }

  const isAdminRoute = xPathname.startsWith("/admin");
  const isReceptionRoute = xPathname.startsWith("/reception");
  const isDepartmentRoute = xPathname.startsWith("/department");
  const isSpecialistRoute = xPathname.startsWith("/specialist");
  const isPatientRoute = xPathname.startsWith("/patient");

  const canEnterPatientArea = profile.role === "patient";

  // The area gates and the navigation items ask for permissions that overlap:
  // an administrator may enter the admin area precisely because it may manage
  // staff. The answers were requested above, together with the profile read.
  const [
    canEnterAdminArea,
    canEnterReceptionArea,
    canEnterDepartmentArea,
    canEnterSpecialistArea,
    canManageProfiles,
    canManageStaff,
    canReadRoles,
    canManageDocuments,
    canManageQueue,
    canManagePatients,
    canManageRag,
    canReadSystemLogs,
    canAccessSpecialistPatients,
    canAccessChat,
  ] = await permissionsPromise;

  let isRoleMismatch = false;
  if (isAdminRoute) isRoleMismatch = !canEnterAdminArea;
  if (isReceptionRoute) isRoleMismatch = !canEnterReceptionArea;
  if (isDepartmentRoute) isRoleMismatch = !canEnterDepartmentArea;
  if (isSpecialistRoute) isRoleMismatch = !canEnterSpecialistArea;
  if (isPatientRoute && !canEnterPatientArea) isRoleMismatch = true;

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

  const roleName = await roleNamePromise;

  const sidebarUser = {
    id: profile.id,
    email: user.email || "",
    fullName: profile.full_name,
    role: profile.role,
    roleName,
    department: profile.department,
  };
  const navItems: NavItem[] = [];

  if (profile.role === "admin" && canManageProfiles && canEnterAdminArea) {
    navItems.push({ label: "Dashboard", href: "/admin/dashboard", icon: "LayoutDashboard" });
  }
  if (canManageStaff && canEnterAdminArea) {
    navItems.push({ label: "Staff Management", href: "/admin/staff", icon: "Users" });
  }
  if (canReadRoles && canEnterAdminArea) {
    navItems.push({ label: "Role Management", href: "/admin/roles", icon: "ShieldCheck" });
  }
  if (canManageDocuments && canManageQueue && canEnterReceptionArea) {
    navItems.push({ label: "Reception Queue", href: "/reception/queue", icon: "ClipboardList" });
  }
  if (canManagePatients && canEnterReceptionArea) {
    navItems.push({ label: "Reception Dashboard", href: "/reception/dashboard", icon: "LayoutDashboard" });
  }
  if (canEnterDepartmentArea) {
    navItems.push({ label: "Dept Records", href: "/department/records", icon: "FileSpreadsheet" });
  }
  if (canManageRag && canEnterAdminArea) {
    navItems.push({ label: "RAG Manager", href: "/admin/rag", icon: "Brain" });
  }
  if (canReadSystemLogs && canEnterAdminArea) {
    navItems.push({ label: "System Logs", href: "/admin/logs", icon: "History" });
  }
  if (canAccessSpecialistPatients && canEnterSpecialistArea) {
    navItems.push({ label: "Specialist Dashboard", href: "/specialist/dashboard", icon: "LayoutDashboard" });
    navItems.push({ label: "My Patients", href: "/specialist/patients", icon: "UserCheck" });
  }
  if (canEnterPatientArea) {
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
