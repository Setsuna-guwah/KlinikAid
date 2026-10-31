"use client";

import React, { useId, useMemo, useState, useTransition } from "react";
import { Lock, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PageHeader from "@/components/PageHeader";
import { createCustomRoleAction, deleteCustomRoleAction, updateCustomRoleAction } from "./actions";
import { ROLE_NAME_MAX, validateRoleName } from "@/lib/auth/custom-role-input";
import { roleLabel } from "@/app/(dashboard)/admin/staff/staff-form";
import { focusRingClass } from "@/lib/focus-ring";
import { cn } from "@/lib/utils";
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

interface Draft {
  name: string;
  description: string;
  permissionIds: string[];
}

type Tab = "display" | "permissions";

/** The editor's selection when it holds a role that is not saved yet. */
const NEW_ROLE = "new";
const EMPTY_DRAFT: Draft = { name: "", description: "", permissionIds: [] };

/** `knowledge` → `Knowledge`: module keys are lower-case identifiers. */
function moduleLabel(module: string): string {
  return module.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.permissionIds.length === b.permissionIds.length &&
    a.permissionIds.every((id) => b.permissionIds.includes(id))
  );
}

const groupLabelClass =
  "px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400";

interface RoleListGroupProps {
  label: string;
  roles: Role[];
  selectedId: string | null;
  permissionCount: (role: Role) => number;
  onSelect: (role: Role) => void;
}

function RoleListGroup({ label, roles, selectedId, permissionCount, onSelect }: RoleListGroupProps) {
  if (roles.length === 0) return null;
  return (
    <div>
      <p className={groupLabelClass}>
        {label} — {roles.length}
      </p>
      <ul className="space-y-0.5">
        {roles.map((role) => {
          const selected = role.id === selectedId;
          return (
            <li key={role.id}>
              <button
                type="button"
                onClick={() => onSelect(role)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  focusRingClass,
                  selected
                    ? "bg-slate-200/80 font-medium text-slate-900 dark:bg-slate-800 dark:text-white"
                    : "text-slate-700 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white"
                )}
              >
                {role.is_system ? (
                  <Lock aria-hidden className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
                ) : (
                  <span aria-hidden className="mx-[3px] h-2 w-2 shrink-0 rounded-full bg-primary" />
                )}
                <span className="min-w-0 flex-1 truncate">{roleLabel(role)}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-600 dark:text-slate-400">
                  {permissionCount(role)}
                  <span className="sr-only"> permissions</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function RolesClient({ roles, permissions, mappings }: RolesClientProps) {
  const [isPending, startTransition] = useTransition();
  const idBase = useId();

  // Maps role_id -> Set of permission_ids
  const rolePermissionsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    mappings.forEach((m) => {
      if (!map.has(m.role_id)) {
        map.set(m.role_id, new Set());
      }
      map.get(m.role_id)!.add(m.permission_id);
    });
    return map;
  }, [mappings]);

  const customRoles = roles.filter((role) => !role.is_system);
  const systemRoles = roles.filter((role) => role.is_system);
  const firstRoleId = customRoles[0]?.id ?? systemRoles[0]?.id ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(firstRoleId);
  const [tab, setTab] = useState<Tab>("display");
  const [roleQuery, setRoleQuery] = useState("");
  const [permissionQuery, setPermissionQuery] = useState("");
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);
  const [selectAfterCreate, setSelectAfterCreate] = useState<string | null>(null);

  // A newly created role arrives with the refreshed props; select it then.
  if (selectAfterCreate) {
    const created = roles.find((role) => !role.is_system && role.name === selectAfterCreate);
    if (created) {
      setSelectAfterCreate(null);
      setSelectedId(created.id);
    }
  }

  const isNew = selectedId === NEW_ROLE;
  const selectedRole = isNew ? null : roles.find((role) => role.id === selectedId) ?? null;
  // The selected role is gone (deleted, possibly elsewhere): fall back to the first one.
  if (!isNew && !selectedRole && selectedId !== firstRoleId) {
    setSelectedId(firstRoleId);
  }
  const readOnly = selectedRole?.is_system ?? false;

  const baseline: Draft = useMemo(() => {
    if (!selectedRole) return EMPTY_DRAFT;
    return {
      name: selectedRole.name,
      description: selectedRole.description || "",
      permissionIds: Array.from(rolePermissionsMap.get(selectedRole.id) || []),
    };
  }, [selectedRole, rolePermissionsMap]);

  // The draft restarts from the baseline whenever the selection or the saved role changes.
  const [draft, setDraft] = useState<Draft>(baseline);
  const [draftSource, setDraftSource] = useState(baseline);
  if (draftSource !== baseline) {
    setDraftSource(baseline);
    setDraft(baseline);
  }
  const dirty = isNew || !sameDraft(draft, baseline);

  const permissionCount = (role: Role) => rolePermissionsMap.get(role.id)?.size ?? 0;
  const matchesRole = (role: Role) => {
    const q = roleQuery.trim().toLowerCase();
    return !q || roleLabel(role).toLowerCase().includes(q) || role.name.toLowerCase().includes(q);
  };
  const modules = Array.from(new Set(permissions.map((p) => p.module)));
  const matchesPermission = (perm: Permission) => {
    const q = permissionQuery.trim().toLowerCase();
    return (
      !q ||
      perm.name.toLowerCase().includes(q) ||
      (perm.description || "").toLowerCase().includes(q) ||
      perm.module.toLowerCase().includes(q)
    );
  };

  /** True (and warns) when leaving the current role would discard edits. */
  const blockedByUnsaved = () => {
    if (!dirty || (isNew && sameDraft(draft, EMPTY_DRAFT))) return false;
    toast.warning("You have unsaved changes. Save or reset them first.");
    return true;
  };

  const handleSelect = (role: Role) => {
    if (role.id === selectedId || blockedByUnsaved()) return;
    setSelectedId(role.id);
    setPermissionQuery("");
  };

  const handleStartNew = () => {
    if (isNew || blockedByUnsaved()) return;
    setSelectedId(NEW_ROLE);
    setDraft(EMPTY_DRAFT);
    setTab("display");
    setPermissionQuery("");
  };

  const handleReset = () => {
    if (isNew) {
      setSelectedId(firstRoleId);
      return;
    }
    setDraft(baseline);
  };

  const togglePermission = (permId: string, granted: boolean) => {
    setDraft((prev) => ({
      ...prev,
      permissionIds: granted
        ? [...prev.permissionIds.filter((id) => id !== permId), permId]
        : prev.permissionIds.filter((id) => id !== permId),
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;

    if (!draft.name.trim()) {
      toast.error("Please enter a role name.");
      setTab("display");
      return;
    }

    const nameCheck = validateRoleName(draft.name);
    if (!nameCheck.ok) {
      toast.error(nameCheck.error);
      setTab("display");
      return;
    }

    startTransition(async () => {
      if (isNew) {
        const result = await createCustomRoleAction(draft.name, draft.description, draft.permissionIds);
        if (result.success) {
          toast.success(`Custom role '${nameCheck.name}' created successfully.`);
          setSelectAfterCreate(nameCheck.name);
        } else {
          toast.error(result.error || "Failed to create role.");
        }
        return;
      }

      if (!selectedRole) return;
      const result = await updateCustomRoleAction(selectedRole.id, {
        name: draft.name,
        description: draft.description,
        permissionIds: draft.permissionIds,
      });
      if (result.success) {
        toast.success(`Custom role '${nameCheck.name}' updated successfully.`);
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
        setSelectedId(roles.find((role) => role.id !== deletingRole.id)?.id ?? null);
      } else {
        toast.error(result.error || "Failed to delete role.");
      }
    });
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "display", label: "Display" },
    { id: "permissions", label: `Permissions · ${draft.permissionIds.length}` },
  ];
  const tabId = (id: Tab) => `${idBase}-tab-${id}`;
  const panelId = (id: Tab) => `${idBase}-panel-${id}`;
  const handleTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next: Tab = tab === "display" ? "permissions" : "display";
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  // A built-in role is read-only, so list only what it grants.
  const visiblePermissions = permissions.filter(
    (perm) => matchesPermission(perm) && (!readOnly || draft.permissionIds.includes(perm.id))
  );
  const visibleCustom = customRoles.filter(matchesRole);
  const visibleSystem = systemRoles.filter(matchesRole);

  const labelClass = "text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400";
  const hintClass = "text-xs text-slate-600 dark:text-slate-400";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role & Access Management"
        description="Review the built-in roles, and create custom roles with the permissions they grant"
      />

      <div className="overflow-clip rounded-xl border border-slate-200/80 bg-card shadow-sm dark:border-slate-800 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Role list */}
        <aside className="space-y-4 border-b border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-500" />
              <Input
                value={roleQuery}
                onChange={(e) => setRoleQuery(e.target.value)}
                placeholder="Search roles"
                aria-label="Search roles"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <Button
              type="button"
              size="icon"
              onClick={handleStartNew}
              aria-label="Create Custom Role"
              title="Create Custom Role"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus aria-hidden />
            </Button>
          </div>

          <nav aria-label="Roles" className="space-y-4">
            {isNew && (
              <div>
                <p className={groupLabelClass}>Unsaved</p>
                <div className="flex items-center gap-2 rounded-md bg-slate-200/80 px-2 py-1.5 text-sm font-medium text-slate-900 dark:bg-slate-800 dark:text-white">
                  <span aria-hidden className="mx-[3px] h-2 w-2 shrink-0 rounded-full border border-primary" />
                  <span className="truncate">{draft.name.trim() || "New role"}</span>
                </div>
              </div>
            )}
            <RoleListGroup
              label="Custom roles"
              roles={visibleCustom}
              selectedId={selectedId}
              permissionCount={permissionCount}
              onSelect={handleSelect}
            />
            <RoleListGroup
              label="System roles"
              roles={visibleSystem}
              selectedId={selectedId}
              permissionCount={permissionCount}
              onSelect={handleSelect}
            />
            {visibleCustom.length + visibleSystem.length === 0 && (
              <p className="px-2 text-sm text-slate-600 dark:text-slate-400">No roles match.</p>
            )}
          </nav>
        </aside>

        {/* Role editor */}
        {selectedRole || isNew ? (
          <form onSubmit={handleSave} className="flex min-w-0 flex-col">
            <div className="space-y-1 px-6 pt-5">
              <p className={labelClass}>{isNew ? "Create role" : readOnly ? "View role" : "Edit role"}</p>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                  {selectedRole ? roleLabel(selectedRole) : draft.name.trim() || "New role"}
                </h2>
                {selectedRole && roleLabel(selectedRole) !== selectedRole.name && (
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {selectedRole.name}
                  </code>
                )}
                {readOnly && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700 dark:border-slate-700 dark:text-slate-300">
                    <Lock aria-hidden className="h-3 w-3" />
                    Built-in
                  </span>
                )}
              </div>
            </div>

            <div
              role="tablist"
              aria-label="Role settings"
              className="mt-4 flex gap-5 border-b border-slate-200 px-6 dark:border-slate-800"
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  id={tabId(t.id)}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls={panelId(t.id)}
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  onKeyDown={handleTabKey}
                  className={cn(
                    "-mb-px rounded-t border-b-2 px-0.5 pb-2.5 pt-1 text-sm font-medium",
                    focusRingClass,
                    tab === t.id
                      ? "border-primary text-slate-900 dark:text-white"
                      : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "display" ? (
              <div
                id={panelId("display")}
                role="tabpanel"
                aria-labelledby={tabId("display")}
                className="max-w-xl space-y-5 px-6 py-5"
              >
                {readOnly && (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                    Built-in roles can&apos;t be edited or deleted here.
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor={`${idBase}-name`} className={labelClass}>
                    Role name
                  </Label>
                  <Input
                    id={`${idBase}-name`}
                    value={readOnly && selectedRole ? roleLabel(selectedRole) : draft.name}
                    onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Junior Lab Technician"
                    readOnly={readOnly}
                    className="h-9"
                  />
                  {!readOnly && (
                    <p className={hintClass}>Up to {ROLE_NAME_MAX} characters; surrounding spaces are ignored.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${idBase}-desc`} className={labelClass}>
                    Description
                  </Label>
                  <Textarea
                    id={`${idBase}-desc`}
                    value={draft.description}
                    onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="What is this role for?"
                    readOnly={readOnly}
                    rows={3}
                  />
                </div>

                {selectedRole && !readOnly && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">Delete role</p>
                      <p className={hintClass}>Only possible when no staff accounts are assigned to it.</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDeletingRole(selectedRole)}
                      className="gap-1.5 text-slate-700 hover:bg-destructive/10 hover:text-destructive-text dark:text-slate-300 dark:hover:text-destructive-text"
                    >
                      <Trash2 aria-hidden />
                      Delete role
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div
                id={panelId("permissions")}
                role="tabpanel"
                aria-labelledby={tabId("permissions")}
                className="space-y-5 px-6 py-5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-0 flex-1 sm:max-w-sm">
                    <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-500" />
                    <Input
                      value={permissionQuery}
                      onChange={(e) => setPermissionQuery(e.target.value)}
                      placeholder="Search permissions"
                      aria-label="Search permissions"
                      className="h-8 pl-8 text-sm"
                    />
                  </div>
                  {readOnly ? (
                    <p className="ml-auto text-xs text-slate-600 dark:text-slate-400">
                      Showing the {draft.permissionIds.length} permissions this role grants
                    </p>
                  ) : (
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDraft((prev) => ({ ...prev, permissionIds: permissions.map((p) => p.id) }))}
                      >
                        Select all
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDraft((prev) => ({ ...prev, permissionIds: [] }))}
                      >
                        Clear permissions
                      </Button>
                    </div>
                  )}
                </div>

                {modules.map((mod) => {
                  const modPerms = visiblePermissions.filter((p) => p.module === mod);
                  if (modPerms.length === 0) return null;
                  return (
                    <section key={mod} aria-label={moduleLabel(mod)}>
                      <h3 className={cn(labelClass, "mb-1")}>{moduleLabel(mod)}</h3>
                      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                        {modPerms.map((perm) => {
                          const switchId = `${idBase}-perm-${perm.id}`;
                          return (
                            <li key={perm.id} className="flex items-center justify-between gap-4 py-2.5">
                              <label htmlFor={switchId} className={cn("min-w-0", !readOnly && "cursor-pointer")}>
                                <span className="block text-sm text-slate-900 dark:text-slate-100">
                                  {perm.description || perm.name}
                                </span>
                                {perm.description && (
                                  <span className="block break-all font-mono text-xs text-slate-600 dark:text-slate-400">
                                    {perm.name}
                                  </span>
                                )}
                              </label>
                              <Switch
                                id={switchId}
                                checked={draft.permissionIds.includes(perm.id)}
                                disabled={readOnly}
                                className="data-unchecked:bg-slate-500 data-disabled:opacity-100 dark:data-unchecked:bg-slate-500"
                                onCheckedChange={(checked) => togglePermission(perm.id, checked)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
                {visiblePermissions.length === 0 && (
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {readOnly && !permissionQuery.trim() ? "This role grants no permissions." : "No permissions match."}
                  </p>
                )}
              </div>
            )}

            {/* Unsaved-changes bar */}
            {!readOnly && dirty && (
              <div className="sticky bottom-4 z-10 mx-4 mb-4 mt-auto">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg ring-1 ring-black/10 dark:bg-slate-800 dark:ring-white/10">
                  <span role="status">
                    {isNew ? "This role isn't saved yet." : "Careful — you have unsaved changes!"}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleReset}
                      className="text-white hover:bg-white/10 hover:text-white"
                    >
                      {isNew ? "Cancel" : "Reset"}
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isPending}
                      className="bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      {isPending ? "Saving..." : isNew ? "Create role" : "Save changes"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </form>
        ) : (
          <div className="flex items-center justify-center p-10 text-sm text-slate-600 dark:text-slate-400">
            Select a role to view its permissions.
          </div>
        )}
      </div>

      <Dialog open={!!deletingRole} onOpenChange={(open) => !open && setDeletingRole(null)}>
        <DialogContent className="bg-white dark:bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-slate-900 dark:text-white">
              Delete {deletingRole ? roleLabel(deletingRole) : "custom role"}?
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-600 dark:text-slate-400">
              The role is removed only if no staff accounts are assigned to it. If any are,
              deletion is blocked until they are moved to another role.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeletingRole(null)} className="h-9">
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isPending}
              onClick={handleDeleteRole}
              className="h-9 bg-destructive font-semibold text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? "Deleting..." : "Delete Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
