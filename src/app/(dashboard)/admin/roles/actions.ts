"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { revalidatePath } from "next/cache";

export async function createCustomRoleAction(
  name: string,
  description: string,
  baseRole: "admin" | "receptionist" | "department_staff" | "medical_specialist" | "patient",
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
        base_role: baseRole
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
      `Custom role '${cleanName}' created (cloned from ${baseRole})`,
      null,
      { role_id: newRole.id, role_name: cleanName, base_role: baseRole, permission_count: permissionIds.length }
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
