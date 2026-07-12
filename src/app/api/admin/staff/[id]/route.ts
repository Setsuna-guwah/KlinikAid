import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { validateName } from "@/lib/validation";

export const dynamic = "force-dynamic";

// PUT: update staff details (full name, email, role, department)
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const adminProfile = await requireRole(["admin"]);
    const { id } = params;
    const body = await request.json();
    const { email, fullName, role, department } = body;

    if (!email || !fullName || !role) {
      return errorResponse("Missing required fields: email, fullName, role", 400);
    }

    const nameCheck = validateName(fullName, "Full name");
    if (!nameCheck.valid) {
      return errorResponse(nameCheck.error ?? "Invalid full name.", 400);
    }

    if (role === "department_staff" && (!department || department === null)) {
      return errorResponse("Clinical department is required for Department Staff.", 400);
    }

    const adminClient = createAdminClient();
    const supabase = createClient();

    // 1. Update Auth user (email & metadata only — password changes are client-driven via forgot-password or profile)
    const updateParams: {
      email: string;
      user_metadata: {
        full_name: string;
        role: string;
        department: string | null;
      };
    } = {
      email,
      user_metadata: {
        full_name: fullName,
        role,
        department: role === "department_staff" ? department : null,
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
        role,
        department: role === "department_staff" ? department : null,
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
      `Staff user updated: ${fullName} (${email}) as ${role}`,
      null,
      { target_user_id: id, role, department }
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
