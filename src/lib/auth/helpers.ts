import { createClient } from "@/lib/supabase/server";
import { Profile, UserRole, Department } from "@/types";
import { User } from "@supabase/supabase-js";

/**
 * Retrieves the current authenticated user and their associated profile.
 * Server-side only (Server Components, Actions, Routes).
 */
export async function getCurrentUser(): Promise<{
  user: User | null;
  profile: Profile | null;
}> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { user: null, profile: null };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { user, profile: null };
    }

    return { user, profile: profile as Profile };
  } catch (error) {
    console.error("Error in getCurrentUser:", error);
    return { user: null, profile: null };
  }
}

/**
 * Server guard: Enforces that the active user possesses one of the allowed roles.
 * Returns the profile if successful, otherwise throws an error.
 */
export async function requireRole(allowedRoles: UserRole[]): Promise<Profile> {
  const { user, profile } = await getCurrentUser();

  if (!user || !profile) {
    throw new Error("UNAUTHORIZED: Session not found");
  }

  if (!allowedRoles.includes(profile.role)) {
    throw new Error(`FORBIDDEN: User role '${profile.role}' does not match required roles`);
  }

  return profile;
}

export async function hasPermission(userId: string, permissionName: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("user_has_permission", {
    p_user_id: userId,
    p_permission_name: permissionName,
  });

  if (error) {
    console.error("Permission check failed:", error.message);
    return false;
  }

  return data === true;
}

export async function hasAnyPermission(userId: string, permissionNames: string[]): Promise<boolean> {
  const checks = await Promise.all(permissionNames.map((permissionName) => hasPermission(userId, permissionName)));
  return checks.some(Boolean);
}

export async function requirePermission(permissionName: string): Promise<Profile> {
  const { user, profile } = await getCurrentUser();

  if (!user || !profile) {
    throw new Error("UNAUTHORIZED: Session not found");
  }

  const allowed = await hasPermission(user.id, permissionName);
  if (!allowed) {
    throw new Error(`FORBIDDEN: Missing permission '${permissionName}'`);
  }

  return profile;
}

export async function requireAnyPermission(permissionNames: string[]): Promise<Profile> {
  const { user, profile } = await getCurrentUser();

  if (!user || !profile) {
    throw new Error("UNAUTHORIZED: Session not found");
  }

  const allowed = await hasAnyPermission(user.id, permissionNames);
  if (!allowed) {
    throw new Error(`FORBIDDEN: Missing one of permissions '${permissionNames.join(", ")}'`);
  }

  return profile;
}

/**
 * Server guard: Enforces that the active user belongs to a specific department.
 * Returns the profile if successful, otherwise throws an error.
 */
export async function requireDepartment(allowedDepartments: Department[]): Promise<Profile> {
  const profile = await requireRole(["admin", "department_staff"]);

  // Admins bypass department isolation at application level
  if (profile.role === "admin") {
    return profile;
  }

  if (!profile.department || !allowedDepartments.includes(profile.department)) {
    throw new Error(
      `FORBIDDEN: Department '${profile.department || "none"}' does not match required departments`
    );
  }

  return profile;
}
