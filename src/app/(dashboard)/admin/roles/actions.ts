"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { revalidatePath } from "next/cache";

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  base_role: string | null;
};

type ProfileWithRoleId = {
  role_id?: string | null;
};

type BaseRole = "admin" | "receptionist" | "department_staff" | "medical_specialist" | "patient";

const DEFAULT_CUSTOM_ROLE_BASE_ROLE: BaseRole = "receptionist";

function normalizePermissionIds(permissionIds: unknown): string[] {
  if (!Array.isArray(permissionIds)) return [];
  return Array.from(
    new Set(permissionIds.filter((permissionId): permissionId is string => typeof permissionId === "string" && permissionId.trim().length > 0))
  );
}

function getCallerRoleId(profile: ProfileWithRoleId): string | null {
  return typeof profile.role_id === "string" ? profile.role_id : null;
}

export async function createCustomRoleAction(
  name: string,
  description: string,
  permissionIds: string[]
) {
  try {
    const adminProfile = await requirePermission("roles.manage");
    
    if (!name || name.trim().length < 3) {
      return { success: false, error: "Role name must be at least 3 characters." };
    }
    
    const cleanName = name.trim();

    const supabase = createClient();

    // Validate that role name is unique
    const { data: existingRole } = await supabase
      .from("roles")
      .select("id")
      .eq("name", cleanName)
      .maybeSingle();

    if (existingRole) {
      return { success: false, error: "A role with this name already exists." };
    }

    // 1. Create the new custom role row
    const { data: newRole, error: roleCreateError } = await supabase
      .from("roles")
      .insert({
        name: cleanName,
        description: description || null,
        is_system: false,
        base_role: DEFAULT_CUSTOM_ROLE_BASE_ROLE
      })
      .select()
      .single();

    if (roleCreateError || !newRole) {
      throw roleCreateError || new Error("Failed to create role row.");
    }

    // 2. Map permissions to the custom role in role_permissions
    if (permissionIds.length > 0) {
      const mappingRows = permissionIds.map((pId) => ({
        role_id: newRole.id,
        permission_id: pId
      }));

      const { error: mappingError } = await supabase
        .from("role_permissions")
        .insert(mappingRows);

      if (mappingError) {
        throw mappingError;
      }
    }

    // 3. Log CUSTOM_ROLE_CREATED mutation event
    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.CUSTOM_ROLE_CREATED,
      `Custom role '${cleanName}' created`,
      null,
      {
        role_id: newRole.id,
        role_name: cleanName,
        base_role: DEFAULT_CUSTOM_ROLE_BASE_ROLE,
        permission_count: permissionIds.length,
      }
    );

    revalidatePath("/admin/roles");
    return { success: true };
  } catch (err: unknown) {
    console.error("Error creating custom role:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create custom role."
    };
  }
}

export async function updateCustomRoleAction(
  roleId: string,
  values: {
    name: string;
    description: string;
    permissionIds: string[];
  }
) {
  try {
    const adminProfile = await requirePermission("roles.manage");

    if (!roleId || typeof roleId !== "string") {
      return { success: false, error: "Select a valid role." };
    }

    if (roleId === getCallerRoleId(adminProfile as ProfileWithRoleId)) {
      return { success: false, error: "You cannot modify your own assigned role." };
    }

    if (!values.name || values.name.trim().length < 3) {
      return { success: false, error: "Role name must be at least 3 characters." };
    }

    const cleanName = values.name.trim();
    const cleanDescription = values.description?.trim() || null;
    const permissionIds = normalizePermissionIds(values.permissionIds);

    const supabase = createClient();

    const { data: role, error: roleError } = await supabase
      .from("roles")
      .select("*")
      .eq("id", roleId)
      .single<RoleRow>();

    if (roleError || !role) {
      return { success: false, error: "Select a valid role." };
    }

    if (role.is_system) {
      return { success: false, error: "System roles cannot be edited." };
    }

    const { data: existingRole } = await supabase
      .from("roles")
      .select("id")
      .eq("name", cleanName)
      .neq("id", roleId)
      .maybeSingle();

    if (existingRole) {
      return { success: false, error: "A role with this name already exists." };
    }

    const { error: updateError } = await supabase
      .from("roles")
      .update({
        name: cleanName,
        description: cleanDescription,
        updated_at: new Date().toISOString(),
      })
      .eq("id", roleId);

    if (updateError) {
      throw updateError;
    }

    const { error: deleteMappingsError } = await supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId);

    if (deleteMappingsError) {
      throw deleteMappingsError;
    }

    if (permissionIds.length > 0) {
      const mappingRows = permissionIds.map((permissionId) => ({
        role_id: roleId,
        permission_id: permissionId,
      }));

      const { error: insertMappingsError } = await supabase
        .from("role_permissions")
        .insert(mappingRows);

      if (insertMappingsError) {
        throw insertMappingsError;
      }
    }

    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.ROLE_UPDATED,
      `Custom role '${cleanName}' updated`,
      null,
      {
        role_id: roleId,
        previous_role_name: role.name,
        role_name: cleanName,
        previous_base_role: role.base_role,
        base_role: role.base_role,
        permission_count: permissionIds.length,
      }
    );

    revalidatePath("/admin/roles");
    return { success: true };
  } catch (err: unknown) {
    console.error("Error updating custom role:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update custom role.",
    };
  }
}

export async function deleteCustomRoleAction(roleId: string) {
  try {
    const adminProfile = await requirePermission("roles.manage");

    if (!roleId || typeof roleId !== "string") {
      return { success: false, error: "Select a valid role." };
    }

    if (roleId === getCallerRoleId(adminProfile as ProfileWithRoleId)) {
      return { success: false, error: "You cannot modify your own assigned role." };
    }

    const supabase = createClient();

    const { data: role, error: roleError } = await supabase
      .from("roles")
      .select("*")
      .eq("id", roleId)
      .single<RoleRow>();

    if (roleError || !role) {
      return { success: false, error: "Select a valid role." };
    }

    if (role.is_system) {
      return { success: false, error: "System roles cannot be deleted." };
    }

    const { count: assignedCount, error: assignedCountError } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role_id", roleId);

    if (assignedCountError) {
      throw assignedCountError;
    }

    if ((assignedCount || 0) > 0) {
      return {
        success: false,
        error: `Reassign ${assignedCount} user(s) before deleting this role.`,
      };
    }

    const { error: deleteMappingsError } = await supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId);

    if (deleteMappingsError) {
      throw deleteMappingsError;
    }

    const { error: deleteRoleError } = await supabase
      .from("roles")
      .delete()
      .eq("id", roleId);

    if (deleteRoleError) {
      throw deleteRoleError;
    }

    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.ROLE_DELETED,
      `Custom role '${role.name}' deleted`,
      null,
      {
        role_id: roleId,
        role_name: role.name,
        base_role: role.base_role,
      }
    );

    revalidatePath("/admin/roles");
    return { success: true };
  } catch (err: unknown) {
    console.error("Error deleting custom role:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete custom role.",
    };
  }
}

export async function getRolesAction() {
  try {
    await requirePermission("roles.manage");
    const supabase = createClient();
    const { data, error } = await supabase
      .from("roles")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (err: unknown) {
    console.error("Error fetching roles:", err);
    return { success: false, error: err instanceof Error ? err.message : "Failed to fetch roles." };
  }
}
