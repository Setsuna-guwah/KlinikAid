import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyRead, type ReadOutcome } from "@/lib/read-outcome";
import { timed } from "@/lib/perf/timing";

/**
 * One row of the staff registry, as the Staff Management page renders it. Only
 * the columns the page reads are listed here, and the fetch below returns no
 * others.
 */
export type StaffRegistryRow = {
  id: string;
  full_name: string;
  /** Blank when the profile has no Auth user (#229): the row stays listed. */
  email: string;
  role: string;
  role_id: string | null;
  department: string | null;
  employee_type: string | null;
  is_active: boolean;
  created_at: string;
};

export type StaffRegistryOutcome =
  | { readonly kind: "ok"; readonly data: StaffRegistryRow[] }
  | { readonly kind: "failed"; readonly error: unknown };

/** A row as the database returns it: the email is null when no Auth user exists. */
type RegistryDbRow = Omit<StaffRegistryRow, "email"> & { email: string | null };

/** PostgREST's "function not found in the schema cache": migration_45 is not applied. */
const MISSING_FUNCTION_CODE = "PGRST202";

/** SQLSTATE 42501, insufficient_privilege: the database refused the caller. */
const PERMISSION_DENIED_CODE = "42501";

/**
 * Bounded so a large staff list cannot open unbounded parallel requests against
 * GoTrue. Only the fallback path uses it.
 */
const STAFF_EMAIL_LOOKUP_CONCURRENCY = 10;

function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

export function isStaffRegistryPermissionDenied(error: unknown): boolean {
  return codeOf(error) === PERMISSION_DENIED_CODE;
}

/**
 * Resolve Auth emails for exactly the staff profile ids on screen (#229).
 *
 * Used only when list_staff_registry() is not installed. Each id costs one small
 * request, so the cost tracks the registry on screen rather than the size of the
 * auth-user table.
 *
 * A profile can outlive its Auth user. That is a missing email for one row, not
 * a failed registry read, so the id is logged and left without an email instead
 * of failing the whole page.
 */
async function fetchStaffEmails(
  adminClient: SupabaseClient,
  profileIds: string[]
): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  for (let i = 0; i < profileIds.length; i += STAFF_EMAIL_LOOKUP_CONCURRENCY) {
    const batch = profileIds.slice(i, i + STAFF_EMAIL_LOOKUP_CONCURRENCY);
    // allSettled: a lookup that throws (not just one that returns an error)
    // must cost one row its email, not fail the whole registry.
    const results = await Promise.allSettled(batch.map((id) => adminClient.auth.admin.getUserById(id)));
    results.forEach((settled, index) => {
      const id = batch[index];
      const error = settled.status === "rejected" ? settled.reason : settled.value.error;
      const user = settled.status === "fulfilled" ? settled.value.data?.user : null;
      if (error || !user) {
        console.warn("Staff registry: no Auth user for profile", id, errorMessage(error));
        return;
      }
      emails.set(id, user.email || "");
    });
  }
  return emails;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/**
 * The fallback read: the non-patient profiles, then one Auth lookup per profile.
 * Costs about one round trip per staff member, which is what #236 removes.
 */
async function loadStaffRegistryPerProfile(
  supabase: SupabaseClient,
  adminClient: SupabaseClient
): Promise<StaffRegistryOutcome> {
  const profilesRead = classifyRead(
    await supabase
      .from("profiles")
      .select("id, full_name, role, role_id, department, employee_type, is_active, created_at")
      .neq("role", "patient")
      .order("created_at", { ascending: false })
  );
  if (profilesRead.kind !== "ok") {
    return {
      kind: "failed",
      error: profilesRead.kind === "failed" ? profilesRead.error : new Error("profiles read returned no result"),
    };
  }

  const profiles = (profilesRead.data ?? []) as Omit<StaffRegistryRow, "email">[];
  const emails = await fetchStaffEmails(
    adminClient,
    profiles.map((profile) => profile.id)
  );
  return {
    kind: "ok",
    data: profiles.map((profile) => ({ ...profile, email: emails.get(profile.id) ?? "" })),
  };
}

/**
 * The staff registry for the signed-in caller: one `list_staff_registry()` call
 * made with the caller's own client, so the database applies the staff.manage,
 * is_active and MFA rules itself. Callers must already have checked
 * `staff.manage`; the function refuses again with 42501.
 *
 * Falls back to the per-profile lookup only when the function is missing
 * (PGRST202), so this can ship before migration_45 is applied. Any other failure
 * is returned as `failed`, never as an empty registry.
 *
 * Reusable from a route handler or a server component.
 */
export async function loadStaffRegistry(
  supabase: SupabaseClient,
  adminClient: SupabaseClient
): Promise<StaffRegistryOutcome> {
  const read: ReadOutcome<RegistryDbRow[]> = classifyRead(
    await timed("admin.staff.rpc.list_staff_registry", () => supabase.rpc("list_staff_registry"))
  );

  if (read.kind === "failed") {
    if (codeOf(read.error) !== MISSING_FUNCTION_CODE) {
      return { kind: "failed", error: read.error };
    }
    console.warn(
      "Staff registry: list_staff_registry() is not installed (migration_45); using per-profile Auth lookups."
    );
    return loadStaffRegistryPerProfile(supabase, adminClient);
  }

  // A list query never reports "absent" (PGRST116 is for single-row reads), so
  // anything other than an array is a failed read rather than an empty list.
  if (read.kind === "absent" || !Array.isArray(read.data)) {
    return { kind: "failed", error: new Error("list_staff_registry returned an unexpected shape") };
  }

  return {
    kind: "ok",
    data: read.data.map((row) => ({ ...row, email: row.email ?? "" })),
  };
}
