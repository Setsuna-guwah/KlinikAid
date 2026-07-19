import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import RolesClient from "./RolesClient";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  await requirePermission("roles.read");
  const supabase = createClient();

  // Load roles, permissions and mappings
  const [rolesRes, permissionsRes, mappingsRes] = await Promise.all([
    supabase
      .from("roles")
      .select("*")
      .order("is_system", { ascending: false })
      .order("name", { ascending: true }),
    supabase
      .from("permissions")
      .select("*")
      .order("module", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("role_permissions")
      .select("*")
  ]);

  if (rolesRes.error) throw rolesRes.error;
  if (permissionsRes.error) throw permissionsRes.error;
  if (mappingsRes.error) throw mappingsRes.error;

  return (
    <RolesClient
      roles={rolesRes.data || []}
      permissions={permissionsRes.data || []}
      mappings={mappingsRes.data || []}
    />
  );
}
