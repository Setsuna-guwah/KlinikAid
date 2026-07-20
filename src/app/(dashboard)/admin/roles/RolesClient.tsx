"use client";

import React, { useState, useTransition } from "react";
import { 
  Shield, 
  ShieldAlert,
  Plus, 
  Check, 
  Server,
  Lock,
  Settings,
  FolderLock,
  Edit2,
  Trash2
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createCustomRoleAction, deleteCustomRoleAction, updateCustomRoleAction } from "./actions";
import { toast } from "sonner";

interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  base_role: string | null;
}

interface Permission {
  id: string;
  name: string;
  description: string | null;
  module: string;
}

interface Mapping {
  role_id: string;
  permission_id: string;
}

interface RolesClientProps {
  roles: Role[];
  permissions: Permission[];
  mappings: Mapping[];
}

interface PermissionCatalogPickerProps {
  modules: string[];
  permissions: Permission[];
  selectedPermissionIds: string[];
  onTogglePermission: (permissionId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

function PermissionCatalogPicker({
  modules,
  permissions,
  selectedPermissionIds,
  onTogglePermission,
  onSelectAll,
  onDeselectAll,
}: PermissionCatalogPickerProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-150 bg-slate-50/50 dark:border-slate-850 dark:bg-slate-950/20">
      <div className="flex flex-col gap-2 border-b border-slate-100 bg-white/70 px-4 py-3 dark:border-slate-900 dark:bg-slate-950/40 sm:flex-row sm:items-center sm:justify-between">
        <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Toggle Permissions Catalog</Label>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onSelectAll} className="h-8 text-[10px] font-semibold">
            Select All
          </Button>
          <Button type="button" variant="outline" onClick={onDeselectAll} className="h-8 text-[10px] font-semibold">
            Deselect All
          </Button>
        </div>
      </div>
      <div className="max-h-[360px] space-y-5 overflow-y-auto p-4">
        {modules.map((mod) => {
          const modPerms = permissions.filter((p) => p.module === mod);
          return (
            <div key={mod} className="space-y-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-900 pb-1">{mod}</h4>
              <div className="space-y-2 pl-1">
                {modPerms.map((perm) => {
                  const checked = selectedPermissionIds.includes(perm.id);
                  return (
                    <label
                      key={perm.id}
                      className="flex items-start gap-2.5 cursor-pointer text-xs group"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onTogglePermission(perm.id)}
                        className="mt-0.5 rounded border-slate-300 dark:border-slate-800 text-indigo-600 focus:ring-indigo-500/20 h-3.5 w-3.5"
                      />
                      <div className="space-y-0.5">
                        <span className="font-semibold text-slate-850 dark:text-slate-200 group-hover:text-indigo-500 transition-colors">{perm.name}</span>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">{perm.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RolesClient({ roles, permissions, mappings }: RolesClientProps) {
  const [isPending, startTransition] = useTransition();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [editRoleName, setEditRoleName] = useState("");
  const [editRoleDesc, setEditRoleDesc] = useState("");
  const [editSelectedPermissions, setEditSelectedPermissions] = useState<string[]>([]);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  // Group permissions by module
  const modules = Array.from(new Set(permissions.map((p) => p.module)));

  // Maps role_id -> Set of permission_ids
  const rolePermissionsMap = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    mappings.forEach((m) => {
      if (!map.has(m.role_id)) {
        map.set(m.role_id, new Set());
      }
      map.get(m.role_id)!.add(m.permission_id);
    });
    return map;
  }, [mappings]);

  // Toggle permission checkbox
  const handleTogglePermission = (permId: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permId) ? prev.filter((id) => id !== permId) : [...prev, permId]
    );
  };

  const handleToggleEditPermission = (permId: string) => {
    setEditSelectedPermissions((prev) =>
      prev.includes(permId) ? prev.filter((id) => id !== permId) : [...prev, permId]
    );
  };

  const handleEditOpen = (role: Role) => {
    setEditingRole(role);
    setEditRoleName(role.name);
    setEditRoleDesc(role.description || "");
    setEditSelectedPermissions(Array.from(rolePermissionsMap.get(role.id) || []));
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;

    if (!editRoleName.trim()) {
      toast.error("Please enter a role name.");
      return;
    }

    startTransition(async () => {
      const result = await updateCustomRoleAction(editingRole.id, {
        name: editRoleName,
        description: editRoleDesc,
        permissionIds: editSelectedPermissions,
      });

      if (result.success) {
        toast.success(`Custom role '${editRoleName}' updated successfully.`);
        setEditingRole(null);
      } else {
        toast.error(result.error || "Failed to update role.");
      }
    });
  };

  const handleDeleteRole = async () => {
    if (!deletingRole) return;

    startTransition(async () => {
      const result = await deleteCustomRoleAction(deletingRole.id);

      if (result.success) {
        toast.success(`Custom role '${deletingRole.name}' deleted successfully.`);
        setDeletingRole(null);
      } else {
        toast.error(result.error || "Failed to delete role.");
      }
    });
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) {
      toast.error("Please enter a role name.");
      return;
    }

    startTransition(async () => {
      const result = await createCustomRoleAction(
        newRoleName,
        newRoleDesc,
        selectedPermissions
      );

      if (result.success) {
        toast.success(`Custom role '${newRoleName}' created successfully.`);
        setNewRoleName("");
        setNewRoleDesc("");
        setShowCreateForm(false);
      } else {
        toast.error(result.error || "Failed to create role.");
      }
    });
  };

  return (
    <div className="space-y-8 p-1 sm:p-2">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <FolderLock className="h-6 w-6 text-indigo-500" />
            Role & Access Management
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Configure shadow roles and permissions catalog. Note: permissions are additive and do not affect active routing gates.
          </p>
        </div>
        <div>
          {!showCreateForm && (
            <Button 
              onClick={() => {
                setShowCreateForm(true);
                setSelectedPermissions([]);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs h-9 flex items-center gap-1.5 shadow-sm transition-all"
            >
              <Plus className="h-4 w-4" />
              Create Custom Role
            </Button>
          )}
        </div>
      </div>

      {/* Create Custom Role Dialog / Panel */}
      {showCreateForm && (
        <Card className="border border-indigo-150 dark:border-slate-800 bg-white/50 dark:bg-slate-950/40 backdrop-blur-md shadow-md animate-in fade-in slide-in-from-top-3 duration-250">
          <CardHeader className="border-b border-slate-100 dark:border-slate-850/50 pb-4">
            <CardTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Settings className="h-4 w-4 text-indigo-500" />
              Build Custom Role
            </CardTitle>
            <CardDescription className="text-xs">
              Create a custom role from scratch by selecting its access category and permissions.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={handleCreateRole} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left fields */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="role-name" className="text-xs font-bold text-slate-700 dark:text-slate-300">Role Name</Label>
                    <Input
                      id="role-name"
                      placeholder="e.g. Junior Lab Technician"
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      className="text-xs h-10 border-slate-200 dark:border-slate-800 focus-visible:ring-indigo-500/20"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="role-desc" className="text-xs font-bold text-slate-700 dark:text-slate-300">Description</Label>
                    <Textarea
                      id="role-desc"
                      placeholder="Briefly explain scope of this custom role..."
                      value={newRoleDesc}
                      onChange={(e) => setNewRoleDesc(e.target.value)}
                      rows={3}
                      className="text-xs border-slate-200 dark:border-slate-800 focus-visible:ring-indigo-500/20"
                    />
                  </div>

                </div>

                {/* Right fields: Permissions selection grouped by module */}
                <PermissionCatalogPicker
                  modules={modules}
                  permissions={permissions}
                  selectedPermissionIds={selectedPermissions}
                  onTogglePermission={handleTogglePermission}
                  onSelectAll={() => setSelectedPermissions(permissions.map((permission) => permission.id))}
                  onDeselectAll={() => setSelectedPermissions([])}
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-850/50 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateForm(false)}
                  className="text-xs h-9"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs h-9 shadow-sm"
                >
                  {isPending ? "Creating..." : "Save Custom Role"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editingRole} onOpenChange={(open) => !open && setEditingRole(null)}>
        <DialogContent className="max-w-3xl bg-white dark:bg-slate-950">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Edit2 className="h-4 w-4 text-indigo-500" />
              Edit Custom Role
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
              Update this custom role&apos;s name, description, and granted permissions.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateRole} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-role-name" className="text-xs font-bold text-slate-700 dark:text-slate-300">Role Name</Label>
                  <Input
                    id="edit-role-name"
                    value={editRoleName}
                    onChange={(e) => setEditRoleName(e.target.value)}
                    className="text-xs h-10 border-slate-200 dark:border-slate-800 focus-visible:ring-indigo-500/20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-role-desc" className="text-xs font-bold text-slate-700 dark:text-slate-300">Description</Label>
                  <Textarea
                    id="edit-role-desc"
                    value={editRoleDesc}
                    onChange={(e) => setEditRoleDesc(e.target.value)}
                    rows={4}
                    className="text-xs border-slate-200 dark:border-slate-800 focus-visible:ring-indigo-500/20"
                  />
                </div>

                <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-[10px] text-slate-600 dark:border-indigo-950 dark:bg-indigo-950/20 dark:text-slate-300">
                  Permission changes take effect on each affected user&apos;s next request or login.
                </div>
              </div>

              <PermissionCatalogPicker
                modules={modules}
                permissions={permissions}
                selectedPermissionIds={editSelectedPermissions}
                onTogglePermission={handleToggleEditPermission}
                onSelectAll={() => setEditSelectedPermissions(permissions.map((permission) => permission.id))}
                onDeselectAll={() => setEditSelectedPermissions([])}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingRole(null)}
                className="text-xs h-9"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs h-9"
              >
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingRole} onOpenChange={(open) => !open && setDeletingRole(null)}>
        <DialogContent className="bg-white dark:bg-slate-950">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-rose-500" />
              Delete Custom Role
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
              This action removes the custom role only if no staff accounts are currently assigned to it.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-rose-100 bg-rose-50/70 p-3 text-xs text-rose-800 dark:border-rose-950 dark:bg-rose-950/20 dark:text-rose-200">
            Delete <span className="font-bold">{deletingRole?.name}</span>? If any users are assigned, deletion will be blocked and those users must be reassigned first.
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingRole(null)}
              className="text-xs h-9"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isPending}
              onClick={handleDeleteRole}
              className="bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs h-9"
            >
              {isPending ? "Deleting..." : "Delete Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dynamic Roles List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {roles.map((role) => {
          const rolePermIds = rolePermissionsMap.get(role.id) || new Set();
          const rolePerms = permissions.filter((p) => rolePermIds.has(p.id));
          
          return (
            <Card key={role.id} className="border border-slate-200/80 dark:border-slate-850 bg-white/70 dark:bg-slate-950/20 hover:shadow-md transition-all flex flex-col h-full relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-[2px] bg-slate-100 dark:bg-slate-900 group-hover:bg-indigo-500 transition-colors" />
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Shield className="h-4 w-4 text-indigo-500 shrink-0" />
                      {role.name}
                    </CardTitle>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5 leading-snug">{role.description || "No description provided."}</p>
                  </div>
                  {role.is_system ? (
                    <Badge variant="outline" className="text-[9px] font-semibold tracking-wide uppercase px-2 py-0.5 border-indigo-100 dark:border-indigo-950 text-indigo-600 bg-indigo-50/30 dark:bg-indigo-950/10 flex items-center gap-1 shrink-0">
                      <Lock className="h-2.5 w-2.5" />
                      System
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] font-semibold tracking-wide uppercase px-2 py-0.5 border-emerald-100 dark:border-emerald-950 text-emerald-600 bg-emerald-50/30 dark:bg-emerald-950/10 flex items-center gap-1 shrink-0">
                      <Server className="h-2.5 w-2.5" />
                      Custom
                    </Badge>
                  )}
                </div>
              </CardHeader>
              
              <CardContent className="pt-3 border-t border-slate-100 dark:border-slate-850/50 flex-grow flex flex-col justify-between">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Granted Permissions ({rolePerms.length})</h4>
                  {rolePerms.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pb-2">
                      {rolePerms.map((perm) => (
                        <span 
                          key={perm.id} 
                          className="inline-flex items-center gap-1 text-[9px] font-semibold text-slate-600 dark:text-slate-350 bg-slate-100 dark:bg-slate-900 border border-slate-150 dark:border-slate-850/60 px-2 py-0.5 rounded shadow-sm"
                          title={perm.description || undefined}
                        >
                          <Check className="h-2.5 w-2.5 text-indigo-500" />
                          {perm.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-450 italic flex items-center gap-1">
                      <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
                      No permissions granted.
                    </p>
                  )}
                </div>
                {!role.is_system && (
                  <div className="flex items-center gap-2 pt-3 mt-3 border-t border-slate-100 dark:border-slate-850/50">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleEditOpen(role)}
                      className="h-8 flex-1 text-xs gap-1.5"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDeletingRole(role)}
                      className="h-8 flex-1 text-xs gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
