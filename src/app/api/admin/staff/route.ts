import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/helpers";
import { AuthError, errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { isStaffRegistryPermissionDenied, loadStaffRegistry } from "@/lib/admin/staff-registry";
import { logEvent } from "@/lib/logger";
import { DEPARTMENTS, SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { validateName } from "@/lib/validation";
import type { Department } from "@/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

function normalizeEmployeeType(value: unknown) {
  if (typeof value !== "string") return null;
  const titles = value
    .split("|")
    .map((title) => title.trim().replace(/\|/g, ""))
    .filter(Boolean)
    .slice(0, 5)
    .map((title) => title.slice(0, 80));

  return titles.length ? titles.join("|") : null;
}

/** Supabase and Auth errors are plain objects with a message, not Error instances. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

function getStaffCreateErrorMessage(error: unknown): { message: string; status: number } {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;

  if (code === "email_exists") {
    return { message: "An account with this email address already exists.", status: 409 };
  }

  if (error instanceof Error && /user already registered/i.test(error.message)) {
    return { message: "An account with this email address already exists.", status: 409 };
  }

  return { message: "Failed to create staff member", status: 500 };
}

const staffEmailSchema = z.string().trim().email("Invalid email address.");

function isDepartment(value: unknown): value is Department {
  return typeof value === "string" && value in DEPARTMENTS;
}

// GET: list all staff members (non-patients) with their Auth email (#229, #236).
// One database call; the registry's shape and fallback live in staff-registry.ts.
export async function GET() {
  try {
    await requirePermission("staff.manage");
    const supabase = await createClient();
    const registry = await loadStaffRegistry(supabase, createAdminClient());

    if (registry.kind === "failed") {
      // The database refusing the caller is the same 403 requirePermission gives.
      // Any other failure is a failed read: never an empty registry.
      if (isStaffRegistryPermissionDenied(registry.error)) {
        throw new AuthError(403, "FORBIDDEN: Missing permission 'staff.manage'");
      }
      throw new Error(errorText(registry.error));
    }

    return successResponse(registry.data);
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to list staff");
  }
}

// POST: create a new staff member
export async function POST(request: Request) {
  let createdUserId: string | null = null;
  let creatorId: string | null = null;
  try {
    const adminProfile = await requirePermission("staff.manage");
    creatorId = adminProfile.id;
    // Preflight every permission the create needs before any Auth or profile
    // work starts (#43, #111, #133, #137): the role lookup below reads roles
    // through the caller-scoped client (roles.read) and the profile update is
    // governed by profiles.manage, which also keeps staff.manage alone from
    // stranding the signup trigger's patient profile. Checked only where each
    // step runs, a denial surfaces as "Select a valid role." after Auth already
    // holds a new user, instead of the established 403.
    await requirePermission("roles.read");
    await requirePermission("profiles.manage");
    const body = await request.json();
    const { email, password, fullName, roleId, department } = body;
    const employeeType = normalizeEmployeeType(body.employeeType);

    // Validate request body
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      typeof fullName !== "string" ||
      typeof roleId !== "string" ||
      !email ||
      !password ||
      !fullName ||
      !roleId
    ) {
      return errorResponse("Missing required fields: email, password, fullName, roleId", 400);
    }

    const emailValidation = staffEmailSchema.safeParse(email);
    if (!emailValidation.success) {
      return errorResponse(emailValidation.error.issues[0]?.message || "Invalid email address.", 400);
    }

    const nameCheck = validateName(fullName, "Full name");
    if (!nameCheck.valid) {
      return errorResponse(nameCheck.error ?? "Invalid full name.", 400);
    }

    const supabase = await createClient();

    // Look up role details from DB
    const { data: dbRole, error: dbRoleError } = await supabase
      .from("roles")
      .select("*")
      .eq("id", roleId)
      .single();

    if (dbRoleError || !dbRole) {
      return errorResponse("Select a valid role.", 400);
    }

    if (dbRole.is_system && dbRole.name === "patient") {
      return errorResponse("The patient role cannot be assigned to staff members.", 400);
    }

    const legacyRoleText = dbRole.is_system ? dbRole.name : dbRole.base_role;

    if (legacyRoleText === "department_staff" && !isDepartment(department)) {
      return errorResponse("Clinical department is required for Department Staff.", 400);
    }

    const adminClient = createAdminClient();
    const normalizedEmail = emailValidation.data;
    const normalizedFullName = fullName.trim();
    const normalizedDepartment = legacyRoleText === "department_staff" ? department : null;

    // 1. Create auth user (trigger will auto-create profile and registration log).
    // Role and department go in app_metadata, never user_metadata: the signup trigger
    // derives privilege from app_metadata only, because user_metadata is writable by
    // the caller at sign-up via the browser-public anon key. See migration_20.sql.
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: normalizedFullName,
        employee_type: employeeType,
      },
      app_metadata: {
        role: legacyRoleText,
        department: normalizedDepartment,
      },
    });

    if (authError || !authData.user) {
      throw authError || new Error("Auth user creation failed");
    }
    createdUserId = authData.user.id;

    // 2. Fetch the newly created profile row. Retries if the database trigger is asynchronous
    let profile = null;
    let retries = 5;

    while (retries > 0) {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authData.user.id)
        .single();

      if (!error && data) {
        profile = data;
        break;
      }
      retries--;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    if (!profile) {
      throw new Error("Trigger failed to create public.profiles record.");
    }

    const { data: updatedProfile, error: profileUpdateError } = await supabase
      .from("profiles")
      .update({ 
        employee_type: employeeType,
        role: legacyRoleText,
        role_id: roleId,
        // The signup trigger provisions every account as patient with a null
        // department (migration_21), so this is where a staff member's
        // department actually gets set.
        department: normalizedDepartment,
      })
      .eq("id", authData.user.id)
      .select()
      .single();

    if (profileUpdateError) {
      throw profileUpdateError;
    }

    profile = updatedProfile;

    // 3. Log the administrative audit event
    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.STAFF_CREATED,
      `Staff user created: ${normalizedFullName} (${normalizedEmail}) as ${legacyRoleText}`,
      null,
      { target_user_id: authData.user.id, role: legacyRoleText, department: normalizedDepartment, employee_type: employeeType }
    );

    // 4. Emit the ROLE_ASSIGNED event (Condition 2)
    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.ROLE_ASSIGNED,
      `Role '${dbRole.name}' assigned to staff member ${normalizedFullName}`,
      null,
      { target_user_id: authData.user.id, role_id: roleId, role_name: dbRole.name, base_role: dbRole.base_role }
    );

    return successResponse(
      { ...profile, email: authData.user.email },
      "Staff account created successfully",
      201
    );
  } catch (error: unknown) {
    let cleanupSucceeded: boolean | null = null;
    if (createdUserId) {
      let cleanupError: unknown = null;
      try {
        const result = await createAdminClient().auth.admin.deleteUser(createdUserId);
        cleanupError = result.error;
      } catch (deleteError) {
        cleanupError = deleteError;
      }
      cleanupSucceeded = !cleanupError;
      const message = errorText(error);
      // logEvent reports a failed insert as { ok: false } rather than throwing.
      // Either way, keep the identifiers an operator needs to reconcile the
      // account in the server log, since the audit row did not land.
      let auditWrite: Awaited<ReturnType<typeof logEvent>>;
      try {
        auditWrite = await logEvent(
          await createClient(),
          creatorId,
          SYSTEM_EVENT_TYPES.STAFF_ACTION_FAILED,
          `Staff user creation failed; Auth cleanup ${cleanupSucceeded ? "succeeded" : "failed"}`,
          null,
          { target_user_id: createdUserId, cleanup_succeeded: cleanupSucceeded, error: message }
        );
      } catch (loggingError) {
        auditWrite = { ok: false, error: loggingError };
      }
      if (!auditWrite.ok) {
        console.error("Failed to record staff creation failure in system_logs:", {
          target_user_id: createdUserId,
          cleanup_succeeded: cleanupSucceeded,
          error: message,
          audit_error: errorText(auditWrite.error),
        });
      }
      if (cleanupError) console.error("Failed to delete incomplete staff Auth user:", cleanupError);
    }
    // A refusal is not a staff-creation failure: a caller without `staff.manage`
    // must not be told "500, try again", because retrying will never succeed.
    if (error instanceof AuthError) {
      return handleRouteError(error, "Failed to create staff member");
    }
    const safeError = getStaffCreateErrorMessage(error);
    const message = errorText(error);
    const cleanupDetail = cleanupSucceeded === null
      ? ""
      : cleanupSucceeded
        ? " The incomplete account was deleted."
        : " Account cleanup failed; remove the incomplete account manually before retrying.";
    return errorResponse(`${safeError.message}${cleanupDetail}`, safeError.status, message);
  }
}
