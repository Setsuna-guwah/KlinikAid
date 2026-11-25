import React from "react";
import { redirect } from "next/navigation";
import { AuthError } from "@/lib/api-response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/helpers";
import { loadStaffRegistry } from "@/lib/admin/staff-registry";
import { timed } from "@/lib/perf/timing";
import { getRolesAction } from "../roles/actions";
import StaffManagementClient from "./StaffManagementClient";
import type { DbRole, StaffMember } from "./staff-form";

export const dynamic = "force-dynamic";

export default async function StaffManagementPage() {
  // A refused guard redirects, as the other admin pages do, instead of
  // throwing into the error boundary.
  try {
    await requirePermission("staff.manage");
  } catch (error: unknown) {
    if (error instanceof AuthError) redirect(error.status === 401 ? "/login" : "/403");
    throw error;
  }
  const supabase = await createClient();

  // Load the staff registry and the role catalogue in parallel so the first
  // render needs no browser round trips. If either server read fails, pass
  // nothing for it so the client falls back to its mount fetch and error UI
  // rather than rendering a failed read as an empty list.
  const [staffResult, rolesResult] = await Promise.all([
    timed("page.staff.registry", async () => {
      try {
        return await loadStaffRegistry(supabase, createAdminClient());
      } catch (error: unknown) {
        return { kind: "failed" as const, error };
      }
    }),
    timed("page.staff.roles", () => getRolesAction()),
  ]);

  if (staffResult.kind === "failed") {
    console.error("Failed to load initial staff registry:", staffResult.error);
  }
  if (!rolesResult.success) {
    console.error("Failed to load initial role catalogue:", rolesResult.error);
  }

  const initialStaff =
    staffResult.kind === "ok" ? (staffResult.data as StaffMember[]) : undefined;
  const initialRoles =
    rolesResult.success && rolesResult.data
      ? (rolesResult.data as DbRole[])
      : undefined;

  return (
    <StaffManagementClient
      initialStaff={initialStaff}
      initialRoles={initialRoles}
    />
  );
}
