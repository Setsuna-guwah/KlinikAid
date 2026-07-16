import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { validateName } from "@/lib/validation";

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

// PUT: update staff details (full name, email, role, department)
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const adminProfile = await requireRole(["admin"]);
    const { id } = params;
    const body = await request.json();
    const { email, fullName, roleId, department } = body;
    const employeeType = normalizeEmployeeType(body.employeeType);

    if (!email || !fullName || !roleId) {
      return errorResponse("Missing required fields: email, fullName, roleId", 400);
    }

    const nameCheck = validateName(fullName, "Full name");
    if (!nameCheck.valid) {
      return errorResponse(nameCheck.error ?? "Invalid full name.", 400);
    }

    const adminClient = createAdminClient();
    const supabase = createClient();

    // Look up role details from DB
    const { data: dbRole, error: dbRoleError } = await supabase
      .from("roles")
      .select("*")
      .eq("id", roleId)
      .single();

    if (dbRoleError || !dbRole) {
      return errorResponse("Select a valid role.", 400);
    }

    if (dbRole.name === "patient" || dbRole.base_role === "patient") {
      return errorResponse("The patient role cannot be assigned to staff members.", 400);
    }

    const legacyRoleText = dbRole.is_system ? dbRole.name : dbRole.base_role;

    if (legacyRoleText === "department_staff" && (!department || department === null)) {
      return errorResponse("Clinical department is required for Department Staff.", 400);
    }

    // 1. Update Auth user (email & metadata only — password changes are client-driven via forgot-password or profile)
    const updateParams: {
      email: string;
      user_metadata: {
        full_name: string;
        role: string;
        department: string | null;
        employee_type: string | null;
      };
    } = {
      email,
      user_metadata: {
        full_name: fullName,
        role: legacyRoleText,
        department: legacyRoleText === "department_staff" ? department : null,
        employee_type: employeeType,
      },
    };

    const { error: authError } = await adminClient.auth.admin.updateUserById(id, updateParams);

    if (authError) {
      throw authError;
    }

    // 2. Update profiles database record
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        role: legacyRoleText,
        role_id: roleId,
        department: legacyRoleText === "department_staff" ? department : null,
        employee_type: employeeType,
      })
      .eq("id", id)
      .select()
      .single();

    if (profileError) {
      throw profileError;
    }

    // 3. Log the update event
    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.STAFF_UPDATED,
      `Staff user updated: ${fullName} (${email}) as ${legacyRoleText}`,
      null,
      { target_user_id: id, role: legacyRoleText, department, employee_type: employeeType }
    );

    // 4. Emit the ROLE_ASSIGNED event (Condition 2)
    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.ROLE_ASSIGNED,
      `Role '${dbRole.name}' assigned to staff member ${fullName}`,
      null,
      { target_user_id: id, role_id: roleId, role_name: dbRole.name, base_role: dbRole.base_role }
    );

    return successResponse({ ...profile, email }, "Staff member updated successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse("Failed to update staff member", 500, message);
  }
}

// PATCH: toggle staff active status (activate / deactivate)
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const adminProfile = await requireRole(["admin"]);
    const { id } = params;
    const body = await request.json();
    const { isActive } = body;

    if (isActive === undefined) {
      return errorResponse("Missing isActive boolean in request body", 400);
    }

    const supabase = createClient();
    const adminClient = createAdminClient();

    // 1. Update active status in profiles table
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .update({
        is_active: isActive,
      })
      .eq("id", id)
      .select()
      .single();

    if (profileError) {
      throw profileError;
    }

    // 2. Revoke sessions globally if deactivating
    if (!isActive) {
      const { error: authError } = await adminClient.auth.admin.signOut(id);
      if (authError) {
        console.error("Warning: failed to revoke session for deactivated user:", authError);
      }
    }

    // 3. Log the active status toggle
    const eventType = isActive ? SYSTEM_EVENT_TYPES.STAFF_ACTIVATED : SYSTEM_EVENT_TYPES.STAFF_DEACTIVATED;
    await logEvent(
      supabase,
      adminProfile.id,
      eventType,
      `Staff user ${isActive ? "activated" : "deactivated"}: ${profile.full_name} (${profile.role})`,
      null,
      { target_user_id: id }
    );

    return successResponse(profile, `Staff member ${isActive ? "activated" : "deactivated"} successfully`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse("Failed to update staff status", 500, message);
  }
}
