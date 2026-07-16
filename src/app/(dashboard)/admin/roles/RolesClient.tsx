"use client";

import React, { useState, useTransition } from "react";
import { 
  Shield, 
  ShieldAlert,
  Plus, 
  Check, 
  Info,
  Server,
  Lock,
  Settings,
  FolderLock
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { createCustomRoleAction } from "./actions";
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

export default function RolesClient({ roles, permissions, mappings }: RolesClientProps) {
  const [isPending, startTransition] = useTransition();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [selectedBaseRole, setSelectedBaseRole] = useState<string>("receptionist");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

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

  // Handle template selection change: load permissions of selected base role
  const handleBaseRoleChange = (baseRoleName: string) => {
    setSelectedBaseRole(baseRoleName);
    const baseRoleObj = roles.find((r) => r.is_system && r.name === baseRoleName);
    if (baseRoleObj) {
      const basePerms = Array.from(rolePermissionsMap.get(baseRoleObj.id) || []);
      setSelectedPermissions(basePerms);
    } else {
      setSelectedPermissions([]);
    }
  };

  // Toggle permission checkbox
  const handleTogglePermission = (permId: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permId) ? prev.filter((id) => id !== permId) : [...prev, permId]
    );
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
        selectedBaseRole as "admin" | "receptionist" | "department_staff" | "medical_specialist" | "patient",
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
                handleBaseRoleChange("receptionist");
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
              Create a shadow-state role by cloning an existing system template and modifying its permissions.
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

                  <div className="space-y-2">
                    <Label htmlFor="base-role" className="text-xs font-bold text-slate-700 dark:text-slate-300">Clone From Template</Label>
                    <select
                      id="base-role"
                      value={selectedBaseRole}
                      onChange={(e) => handleBaseRoleChange(e.target.value)}
                      className="w-full pl-3 pr-8 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 h-10 appearance-none"
                    >
                      <option value="receptionist">Receptionist</option>
                      <option value="department_staff">Department Staff</option>
                      <option value="medical_specialist">Medical Specialist</option>
                      <option value="admin">Administrator</option>
                    </select>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-1 font-medium leading-relaxed">
                      <Info className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                      Assigned users will temporarily resolve legacy routing rules matching this cloned base template.
                    </p>
                  </div>
                </div>

                {/* Right fields: Permissions selection grouped by module */}
                <div className="space-y-4">
                  <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Toggle Permissions Catalog</Label>
                  <div className="border border-slate-150 dark:border-slate-850 rounded-lg p-4 max-h-[320px] overflow-y-auto bg-slate-50/50 dark:bg-slate-950/20 space-y-5">
                    {modules.map((mod) => {
                      const modPerms = permissions.filter((p) => p.module === mod);
                      return (
                        <div key={mod} className="space-y-2">
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-900 pb-1">{mod}</h4>
                          <div className="space-y-2 pl-1">
                            {modPerms.map((perm) => {
                              const checked = selectedPermissions.includes(perm.id);
                              return (
                                <label 
                                  key={perm.id} 
                                  className="flex items-start gap-2.5 cursor-pointer text-xs group"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => handleTogglePermission(perm.id)}
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
                {!role.is_system && role.base_role && (
                  <div className="text-[10px] text-slate-400 mt-2 font-medium flex items-center gap-1">
                    <Info className="h-3 w-3 text-indigo-400" />
                    <span>Resolves to template: <strong>{role.base_role}</strong></span>
                  </div>
                )}
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
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
