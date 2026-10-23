"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import "@/lib/zod-csp";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { USER_ROLES, DEPARTMENTS } from "@/lib/constants";
import { UserRole } from "@/types";
import {
  Plus,
  Search,
  Edit2,
  UserMinus,
  UserPlus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import DataLoadError from "@/components/DataLoadError";
import { fetchJson } from "@/lib/fetch-json";
import { sendStaffResetEmailAction } from "./actions";
import { getRolesAction } from "../roles/actions";
import StaffSheet, { type CreatedAccount } from "@/components/staff/StaffSheet";
import {
  staffFormSchema,
  generateTempPassword,
  parseEmployeeTitles,
  roleLabel,
  type DbRole,
  type StaffFormValues,
  type StaffMember,
} from "./staff-form";
import {
  FILTER_ALL,
  applyStaffFilters,
  buildStaffFilters,
  filterStaff,
  hasActiveFilters,
  parseStaffFilters,
  type DepartmentFilterValue,
  type StatusFilterValue,
} from "./staff-filters";

/**
 * Role badge fill, shared with the sidebar badge (issue #153): white on the
 * *-500/*-600 fills measured 2.28:1 to 4.47:1, so the *-700 step is used in
 * both themes. One map, not a second copy with its own shades.
 */
const ROLE_COLORS: Record<string, { label: string; color: string } | undefined> = USER_ROLES;

/** The department filter offers the clinical departments and "no department". */
const DEPARTMENT_FILTER_OPTIONS: { value: DepartmentFilterValue; label: string }[] = [
  { value: "laboratory", label: DEPARTMENTS.laboratory.label },
  { value: "imaging", label: DEPARTMENTS.imaging.label },
  { value: "ultrasound", label: DEPARTMENTS.ultrasound.label },
  { value: "ecg", label: DEPARTMENTS.ecg.label },
  { value: "none", label: "No department" },
];

const STATUS_FILTER_OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export default function StaffManagementPage() {
  // The filter state lives in the URL, so a filtered view survives a reload and
  // can be shared. The query string is the only source of truth for the three
  // filter dimensions; the search box keeps its own local state, as it always
  // has.
  const searchParams = useSearchParams();
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [dbRoles, setDbRoles] = useState<DbRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);

  // The role catalogue is not optional data. It decides which roles may be
  // granted, and `isDeptStaff` below is derived from it -- so an empty list does
  // not just produce an empty dropdown, it hides the department field and lets a
  // staff account be created with the wrong role/department pairing. That is a
  // privilege grant, so a failed read must never be presented as an empty
  // catalogue. The `roles` table is never legitimately empty in this app.
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [rolesLoaded, setRolesLoaded] = useState(false);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    staffId: string;
    staffName: string;
    targetStatus: boolean;
  }>({
    open: false,
    staffId: "",
    staffName: "",
    targetStatus: false,
  });

  const form = useForm<StaffFormValues>({
    mode: "onTouched",
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      roleId: "",
      department: null,
      employeeType: "",
    },
  });

  const { setValue, watch, reset, setError } = form;
  const watchRoleId = watch("roleId");
  const selectedRoleObj = dbRoles.find(r => r.id === watchRoleId);
  const isDeptStaff = selectedRoleObj?.is_system 
    ? selectedRoleObj.name === "department_staff" 
    : selectedRoleObj?.base_role === "department_staff";

  // Fetch staff list on mount
  const fetchStaff = async () => {
    setLoading(true);
    // Without this, a failed fetch leaves staffList empty and the table below
    // renders "No staff members found / Try adjusting your search query" --
    // telling an operator the registry is empty when it could not be read.
    setFetchError(null);
    try {
      const outcome = await fetchJson<StaffMember[]>("/api/admin/staff");
      if (outcome.kind === "failed") {
        // The rows are cleared, so the table cannot show the last successful
        // answer under a filter that is not the one it was loaded for.
        setStaffList([]);
        setFetchError(outcome.error.message);
        return;
      }
      setStaffList(outcome.data ?? []);
    } catch (err) {
      console.error("Failed to fetch staff:", err);
      setStaffList([]);
      setFetchError(
        err instanceof Error
          ? err.message
          : "The personnel registry could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  };

  // Fetch db roles list on mount
  const fetchRoles = async () => {
    setRolesError(null);
    try {
      const res = await getRolesAction();
      if (res.success && res.data) {
        setDbRoles(res.data);
        setRolesLoaded(true);
      } else {
        setDbRoles([]);
        setRolesLoaded(false);
        setRolesError(
          res.error || "The role catalogue could not be loaded, so staff accounts cannot be created or edited safely."
        );
      }
    } catch (err) {
      console.error("Failed to fetch roles:", err);
      setDbRoles([]);
      setRolesLoaded(false);
      setRolesError(
        err instanceof Error
          ? err.message
          : "The role catalogue could not be loaded, so staff accounts cannot be created or edited safely."
      );
    }
  };

  useEffect(() => {
    fetchStaff();
    fetchRoles();
  }, []);

  // Handle open sheet for create
  const handleCreateOpen = () => {
    setEditingStaff(null);
    const defaultRole = dbRoles.find(r => r.is_system && r.name === "receptionist");
    reset({
      fullName: "",
      email: "",
      password: generateTempPassword(),
      roleId: defaultRole?.id || "",
      department: null,
      employeeType: "",
    });
    setCreated(null);
    setErrorMsg("");
    setSheetOpen(true);
  };

  // Handle open sheet for edit
  const handleEditOpen = (staff: StaffMember) => {
    setEditingStaff(staff);
    reset({
      fullName: staff.full_name,
      email: staff.email,
      password: "", // password blank by default on edit
      roleId: staff.role_id || "",
      department: staff.department as StaffFormValues["department"],
      employeeType: staff.employee_type || "",
    });
    setCreated(null);
    setErrorMsg("");
    setSheetOpen(true);
  };

  // Submit form
  const onSubmit = async (values: StaffFormValues) => {
    try {
      setSubmitting(true);
      setErrorMsg("");

      // Defence in depth against a form rendered from a failed roles read. The
      // UI hides the role picker in that state, but the guard is here because
      // this branch decides what role an account is granted.
      if (!rolesLoaded) {
        setErrorMsg(
          "The role catalogue could not be loaded. No changes were saved — reload the page and try again."
        );
        setSubmitting(false);
        return;
      }

      const isEdit = !!editingStaff;
      const url = isEdit ? `/api/admin/staff/${editingStaff.id}` : "/api/admin/staff";
      const method = isEdit ? "PUT" : "POST";

      const selectedRole = dbRoles.find(r => r.id === values.roleId);
      const legacyRoleText = selectedRole?.is_system ? selectedRole.name : selectedRole?.base_role;
      if (legacyRoleText === "department_staff" && (!values.department || values.department === null)) {
        setError("department", { message: "Choose a clinical department for Department Staff." });
        setSubmitting(false);
        return;
      }

      // On edit, if password is blank, don't send it
      const { password, ...rest } = values;
      const payload = {
        ...rest,
        ...(isEdit && !password ? {} : { password }),
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to save staff member");
      }

      // Success -> refresh list and close sheet
      await fetchStaff();
      if (isEdit) {
        setSheetOpen(false);
      } else {
        // The password was generated here and sent with the request. Show it once; it is not stored.
        setCreated({ name: values.fullName, email: values.email, password: values.password });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setErrorMsg(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = (roleId: string) => {
    setValue("roleId", roleId, { shouldValidate: true, shouldDirty: true });
    const selected = dbRoles.find((r) => r.id === roleId);
    const legacyRoleText = selected?.is_system ? selected.name : selected?.base_role;
    if (legacyRoleText !== "department_staff") {
      setValue("department", null);
    }
  };

  const handleSendReset = async () => {
    if (!editingStaff) return;
    try {
      setSendingReset(true);
      const res = await sendStaffResetEmailAction(editingStaff.email);
      if (res.success) {
        toast.success(`Password reset email sent to ${editingStaff.email}`);
      } else {
        throw new Error(res.error || "Failed to send reset email.");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send reset email.");
    } finally {
      setSendingReset(false);
    }
  };

  // Confirm toggling active status
  const handleStatusToggle = (staff: StaffMember, newStatus: boolean) => {
    setConfirmDialog({
      open: true,
      staffId: staff.id,
      staffName: staff.full_name,
      targetStatus: newStatus,
    });
  };

  // Execute active status toggle
  const executeStatusToggle = async () => {
    try {
      const { staffId, targetStatus } = confirmDialog;
      const outcome = await fetchJson<StaffMember>(`/api/admin/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: targetStatus }),
      });

      if (outcome.kind === "failed") {
        // A failure can still have changed the account (deactivated, but its
        // sessions not confirmed ended), so show the server's state, not ours.
        toast.error(outcome.error.message);
        await fetchStaff();
        return;
      }

      // Update local state instantly
      setStaffList((prev) =>
        prev.map((s) => (s.id === staffId ? { ...s, is_active: targetStatus } : s))
      );
    } finally {
      setConfirmDialog((prev) => ({ ...prev, open: false }));
    }
  };


  const assignableRoles = useMemo(
    () => dbRoles.filter((r) => !(r.is_system && r.name === "patient")),
    [dbRoles]
  );

  // The three filter dimensions are read from the query string. A value the
  // dimension does not know is dropped, so a hand-edited link shows the whole
  // registry rather than an unexplained empty list.
  const parsedFilters = useMemo(() => parseStaffFilters(searchParams), [searchParams]);
  const filters = useMemo(
    () => buildStaffFilters(parsedFilters, dbRoles),
    [parsedFilters, dbRoles]
  );
  const filteredStaff = useMemo(
    () => filterStaff(staffList, filters, searchQuery),
    [staffList, filters, searchQuery]
  );

  // A role filter can only be applied once the catalogue has been read: a
  // profile created before `role_id` existed is recognised by its legacy role
  // text, and only the catalogue says which text belongs to which role. Until
  // then the table would show a filtered list that is missing those rows.
  const rolesSettled = rolesLoaded || rolesError !== null;
  const roleFilterPending = parsedFilters.roleId !== null && !rolesSettled;

  // A failed catalogue read is not the same as a slow one. Without the
  // catalogue the role filter cannot be applied completely -- staff created
  // before roles existed would be dropped -- so the filtered table and its
  // count are not shown at all rather than shown short.
  const roleFilterUnavailable = parsedFilters.roleId !== null && rolesError !== null;

  // The label of the role the URL points at. A role the catalogue does not
  // know keeps its filter -- the rows carrying it are simply not rows this
  // registry holds -- but the operator is told what they are looking at.
  const selectedRoleLabel = useMemo(() => {
    if (!parsedFilters.roleId) return null;
    const known = dbRoles.find((role) => role.id === parsedFilters.roleId);
    if (known) return roleLabel(known);
    if (rolesError) return "Role unavailable";
    return rolesSettled ? "Unknown role" : "Loading roles...";
  }, [parsedFilters.roleId, dbRoles, rolesSettled, rolesError]);

  // The role the URL points at is offered as an option even when it is not one
  // of the roles the staff form may grant, so the selector never shows a bare
  // id for a filter that is being applied.
  const roleOffered = useMemo(
    () => assignableRoles.some((role) => role.id === parsedFilters.roleId),
    [assignableRoles, parsedFilters.roleId]
  );

  const roleFilterItems = useMemo(() => {
    const items: Record<string, string> = { [FILTER_ALL]: "All roles" };
    for (const role of assignableRoles) items[role.id] = roleLabel(role);
    if (selectedRoleLabel && parsedFilters.roleId && !roleOffered) {
      items[parsedFilters.roleId] = selectedRoleLabel;
    }
    return items;
  }, [assignableRoles, selectedRoleLabel, parsedFilters.roleId, roleOffered]);

  const departmentFilterItems = useMemo(() => {
    const items: Record<string, string> = { [FILTER_ALL]: "All departments" };
    for (const option of DEPARTMENT_FILTER_OPTIONS) items[option.value] = option.label;
    return items;
  }, []);

  const statusFilterItems = useMemo(() => {
    const items: Record<string, string> = { [FILTER_ALL]: "All statuses" };
    for (const option of STATUS_FILTER_OPTIONS) items[option.value] = option.label;
    return items;
  }, []);

  /**
   * Write a filter change into the query string.
   *
   * The native history API is used rather than the router: the dashboard
   * layout re-reads the session, the profile and the whole permission set on
   * every navigation, and changing a filter is not a navigation. The URL is
   * read from `window.location` rather than from the render's snapshot, so
   * two filter changes in a row cannot overwrite each other.
   */
  const writeFilters = (patch: {
    roleId?: string | null;
    department?: DepartmentFilterValue | null;
    status?: StatusFilterValue | null;
  }) => {
    const params = applyStaffFilters(new URLSearchParams(window.location.search), patch);
    const query = params.toString();
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.pushState(null, "", url);
  };

  const handleRoleFilterChange = (value: string | null) => {
    writeFilters({ roleId: value && value !== FILTER_ALL ? value : null });
  };

  const handleDepartmentFilterChange = (value: string | null) => {
    writeFilters({
      department: value && value !== FILTER_ALL ? (value as DepartmentFilterValue) : null,
    });
  };

  const handleStatusFilterChange = (value: string | null) => {
    writeFilters({
      status: value && value !== FILTER_ALL ? (value as StatusFilterValue) : null,
    });
  };

  // The search box is a filter too, so one click clears the whole view: a
  // "clear filters" that left the search term behind could still show an
  // empty table and read as a broken button.
  const handleClearFilters = () => {
    setSearchQuery("");
    writeFilters({ roleId: null, department: null, status: null });
  };

  const filtersActive = hasActiveFilters(filters) || searchQuery.trim().length > 0;
  const registryReady = !loading && !fetchError && !roleFilterPending && !roleFilterUnavailable;

  // A query parameter the filter dimensions do not know is ignored by the
  // registry, but it would stay in the link. Drop it, so a shared link does
  // not carry a filter that is not applied and a later reader is not misled
  // about what the view shows.
  useEffect(() => {
    const current = new URLSearchParams(window.location.search);
    const next = new URLSearchParams(current);
    let changed = false;
    if (current.has("role") && !parsedFilters.roleId) {
      next.delete("role");
      changed = true;
    }
    if (current.has("department") && !parsedFilters.department) {
      next.delete("department");
      changed = true;
    }
    if (current.has("status") && !parsedFilters.status) {
      next.delete("status");
      changed = true;
    }
    if (!changed) return;
    const query = next.toString();
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    );
  }, [parsedFilters]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Staff Management"
        description="Create, update, and manage clinic personnel credentials and roles"
        actions={
          <Button
            onClick={handleCreateOpen}
            disabled={!rolesLoaded}
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          >
            <Plus className="h-4 w-4" />
            Add Staff
          </Button>
        }
      />

      {/* Blocking banner. The registry list below is still usable; only the
          privilege-granting form is withheld, because it cannot be rendered
          correctly without the role catalogue. */}
      {rolesError ? (
        <DataLoadError
          what="the role catalogue"
          error={rolesError}
          retryHref="/admin/staff"
        />
      ) : null}

      {/* Main Table Card */}
      <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <CardHeader className="gap-4 pb-3">
          {/* Below `sm` the title and the search stack instead of sharing one
              row: a fixed w-72 beside the title pushes this row's min-content
              width past a 390px card, the card's overflow:hidden clipped the
              search, and because both header rows sit in the same auto grid
              track the filters and the count were stretched out of view too. */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">Personnel Registry</CardTitle>
              <CardDescription className="text-xs">
                System access control for administrative and clinical roles
              </CardDescription>
            </div>

            {/* Search bar: full width when stacked, fixed width beside the
                title once there is room for both. */}
            <div className="relative w-full min-w-0 sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name, email, or role..."
                aria-label="Search staff by name, email, role or title"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs"
              />
            </div>
          </div>

          {/* Filter bar. One selector per dimension, all combinable with each
              other and with the search above. */}
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-border/60 pt-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="staff-filter-role"
                className="text-xs font-medium text-muted-foreground"
              >
                Role
              </label>
              <Select
                value={parsedFilters.roleId ?? FILTER_ALL}
                onValueChange={handleRoleFilterChange}
                items={roleFilterItems}
              >
                <SelectTrigger id="staff-filter-role" className="h-9 w-56 bg-background">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>All roles</SelectItem>
                  {assignableRoles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {roleLabel(role)}
                    </SelectItem>
                  ))}
                  {selectedRoleLabel && parsedFilters.roleId && !roleOffered ? (
                    <SelectItem value={parsedFilters.roleId}>{selectedRoleLabel}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="staff-filter-department"
                className="text-xs font-medium text-muted-foreground"
              >
                Department
              </label>
              <Select
                value={parsedFilters.department ?? FILTER_ALL}
                onValueChange={handleDepartmentFilterChange}
                items={departmentFilterItems}
              >
                <SelectTrigger id="staff-filter-department" className="h-9 w-48 bg-background">
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>All departments</SelectItem>
                  {DEPARTMENT_FILTER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="staff-filter-status"
                className="text-xs font-medium text-muted-foreground"
              >
                Status
              </label>
              <Select
                value={parsedFilters.status ?? FILTER_ALL}
                onValueChange={handleStatusFilterChange}
                items={statusFilterItems}
              >
                <SelectTrigger id="staff-filter-status" className="h-9 w-36 bg-background">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>All statuses</SelectItem>
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleClearFilters}
              disabled={!filtersActive}
              title="Clear the role, department and status filters and the search box"
              className="h-9"
            >
              Clear filters
            </Button>

            {registryReady ? (
              <p
                aria-live="polite"
                data-testid="staff-count"
                className="ml-auto text-xs text-muted-foreground"
              >
                Showing {filteredStaff.length} of {staffList.length} staff members
              </p>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading || roleFilterPending ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-500 dark:text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin text-accentBlue-600 dark:text-accentBlue-400" />
              <span className="text-xs font-medium">Loading personnel registry...</span>
            </div>
          ) : fetchError ? (
            <div className="py-16 px-6">
              <DataLoadError
                what="the personnel registry"
                error={fetchError}
                retryHref="/admin/staff"
              />
            </div>
          ) : roleFilterUnavailable ? (
            <div className="space-y-3 px-6 py-16 text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                The role filter cannot be applied
              </p>
              <p className="mx-auto max-w-md text-xs text-slate-500 dark:text-slate-400">
                The role catalogue could not be loaded, so staff created before roles
                existed cannot be told apart from staff with another role. Clear the
                filters to see the whole registry.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleClearFilters}
                className="mt-1"
              >
                Clear filters
              </Button>
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="text-center py-16 text-slate-500 dark:text-slate-400 space-y-2">
              <p className="text-sm font-semibold">
                {staffList.length === 0
                  ? "No staff members found"
                  : "No staff match these filters"}
              </p>
              <p className="text-xs text-slate-400">
                {staffList.length === 0
                  ? "No staff account has been created yet."
                  : "Try a different role, department or status, or clear the filters."}
              </p>
              {staffList.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClearFilters}
                  className="mt-2"
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : (
            // The kit's cells carry `p-2`; this registry is the widest table
            // in the app, so it keeps 6px instead of 8px per side. The
            // paddings are scoped to this table only (issue #211 asked for
            // the shared Table to be left alone) and buy ~24px of headroom
            // against the longest name in the roster.
            <Table className="[&_td]:px-1.5 [&_th]:px-1.5">
              <TableHeader>
                <TableRow className="bg-slate-50/75 dark:bg-slate-900/40">
                  <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Name</TableHead>
                  <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Email</TableHead>
                  <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Role</TableHead>
                  <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Department</TableHead>
                  <TableHead className="font-semibold text-slate-700 dark:text-slate-300 w-32">Status</TableHead>
                  <TableHead className="font-semibold text-slate-700 dark:text-slate-300 text-right w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStaff.map((staff) => {
                  const deptConfig = staff.department ? DEPARTMENTS[staff.department] : null;
                  const titles = parseEmployeeTitles(staff.employee_type);

                  return (
                    <TableRow
                      key={staff.id}
                      // Inactive rows are marked by the tinted background and
                      // the "Inactive" badge rather than by dimming the whole
                      // row: even at 90% opacity the white-on-colour role
                      // badges inside fall below 4.5:1 (issue #153).
                      className={`transition-colors duration-150 ${!staff.is_active ? "bg-slate-50/40 dark:bg-slate-950/30" : ""}`}
                    >
                      {/* Name */}
                      <TableCell>
                        <div className="font-medium text-slate-900 dark:text-white">{staff.full_name}</div>
                        {titles.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {titles.map((title) => (
                              <Badge
                                key={title}
                                variant="outline"
                                className="text-[10px] font-medium px-1.5 py-0 border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                              >
                                {title}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>

                      {/* Email: the one cell whose content is unbounded free
                          text. The longest address was the widest column in
                          the table, so the table outgrew the card's content
                          box and the Status/Actions columns fell outside it at
                          1280px (issue #211). The cell keeps the kit's nowrap,
                          so the address is clamped instead and the full text
                          stays on the title attribute. */}
                      <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                        <div className="max-w-[150px] truncate" title={staff.email}>
                          {staff.email}
                        </div>
                      </TableCell>

                      {/* Role Badge */}
                      <TableCell>
                        <Badge className={`text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 ${ROLE_COLORS[staff.role]?.color || "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100"}`}>
                          {(() => {
                            const dbRoleObj = dbRoles.find(r => r.id === staff.role_id);
                            return dbRoleObj ? dbRoleObj.name : (USER_ROLES[staff.role as UserRole]?.label || staff.role);
                          })()}
                        </Badge>
                      </TableCell>

                      {/* Department Badge */}
                      <TableCell>
                        {deptConfig ? (
                          <Badge className={`text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 ${deptConfig.color}`}>
                            {deptConfig.label}
                          </Badge>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400 font-mono text-xs">—</span>
                        )}
                      </TableCell>

                      {/* Status Toggle Switch */}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={staff.is_active}
                            onCheckedChange={(checked) => handleStatusToggle(staff, checked)}
                            className="scale-90"
                          />
                          <Badge className={`text-[9px] font-bold px-1.5 py-0 ${staff.is_active
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-200/40"
                              : "bg-rose-100 text-rose-800 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-200/40"
                            }`}>
                            {staff.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditOpen(staff)}
                          aria-label={`Edit ${staff.full_name}`}
                          className="h-8 w-8 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <StaffSheet
        open={sheetOpen}
        onOpenChange={(next) => {
          setSheetOpen(next);
          if (!next) setCreated(null);
        }}
        editingStaff={editingStaff}
        form={form}
        assignableRoles={assignableRoles}
        rolesLoaded={rolesLoaded}
        rolesError={rolesError}
        isDeptStaff={!!isDeptStaff}
        errorMsg={errorMsg}
        submitting={submitting}
        onSubmit={onSubmit}
        onRoleChange={handleRoleChange}
        created={created}
        sendingReset={sendingReset}
        onSendReset={handleSendReset}
      />

      {/* Confirmation Dialog for Status Toggle */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={(isOpen) => setConfirmDialog((prev) => ({ ...prev, open: isOpen }))}
      >
        <DialogContent className="bg-white dark:bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-slate-950 dark:text-white flex items-center gap-2">
              {confirmDialog.targetStatus ? <UserPlus className="h-5 w-5 text-emerald-500" /> : <UserMinus className="h-5 w-5 text-rose-500" />}
              {confirmDialog.targetStatus ? "Activate Account?" : "Deactivate Account?"}
            </DialogTitle>
            <DialogDescription className="text-xs pt-1">
              {confirmDialog.targetStatus
                ? `Are you sure you want to restore active access for ${confirmDialog.staffName}? They will be able to log in immediately.`
                : `Are you sure you want to suspend access for ${confirmDialog.staffName}? All active login sessions will be immediately terminated.`
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirmDialog.targetStatus ? "default" : "destructive"}
              onClick={executeStatusToggle}
              className="text-xs font-semibold"
            >
              {confirmDialog.targetStatus ? "Activate" : "Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
