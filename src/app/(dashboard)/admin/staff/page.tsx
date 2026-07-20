"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { USER_ROLES, DEPARTMENTS } from "@/lib/constants";
import { UserRole, Department } from "@/types";
import {
  Plus,
  Search,
  Edit2,
  UserMinus,
  UserPlus,
  Loader2,
  ShieldAlert,
  Copy,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { sendStaffResetEmailAction } from "./actions";
import { getRolesAction } from "../roles/actions";

// Form validation schema
const staffFormSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters").or(z.string().length(0)), // optional on edit
  roleId: z.string().uuid("Select a valid role"),
  department: z.enum(["laboratory", "imaging", "ultrasound", "ecg"]).nullable().optional(),
  employeeType: z.string().max(404, "Position titles must be 80 characters or fewer, up to 5 titles.").optional(),
});

interface DbRole {
  id: string;
  name: string;
  is_system: boolean;
  base_role: string | null;
  description: string | null;
}

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500 text-white dark:bg-red-600",
  receptionist: "bg-accentBlue-500 text-white dark:bg-accentBlue-600",
  department_staff: "bg-purple-500 text-white dark:bg-purple-600",
  medical_specialist: "bg-indigo-500 text-white dark:bg-indigo-600",
  patient: "bg-green-500 text-white dark:bg-green-600",
};

type StaffFormValues = z.infer<typeof staffFormSchema>;

interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  role: string;
  role_id: string | null;
  department: Department | null;
  employee_type: string | null;
  is_active: boolean;
  created_at: string;
}

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // no 0/O/1/l/I
  const genChunk = (length: number) => {
    let chunk = "";
    for (let i = 0; i < length; i++) {
      chunk += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return chunk;
  };
  return `Klinik-${genChunk(4)}-${genChunk(4)}`;
}

function parseEmployeeTitles(value: string | null | undefined) {
  return (value || "")
    .split("|")
    .map((title) => title.trim())
    .filter(Boolean);
}

function joinEmployeeTitles(titles: string[]) {
  return titles
    .map((title) => title.trim().replace(/\|/g, ""))
    .filter(Boolean)
    .slice(0, 5)
    .join("|");
}

export default function StaffManagementPage() {
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
  const [employeeTitleInput, setEmployeeTitleInput] = useState("");

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

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<StaffFormValues>({
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

  const watchRoleId = watch("roleId");
  const selectedRoleObj = dbRoles.find(r => r.id === watchRoleId);
  const isDeptStaff = selectedRoleObj?.is_system 
    ? selectedRoleObj.name === "department_staff" 
    : selectedRoleObj?.base_role === "department_staff";

  const employeeTitles = parseEmployeeTitles(watch("employeeType"));

  // Fetch staff list on mount
  const fetchStaff = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/staff");
      const json = await res.json();
      if (json.success) {
        setStaffList(json.data);
      }
    } catch (err) {
      console.error("Failed to fetch staff:", err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch db roles list on mount
  const fetchRoles = async () => {
    const res = await getRolesAction();
    if (res.success && res.data) {
      setDbRoles(res.data);
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
    setEmployeeTitleInput("");
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
    setEmployeeTitleInput("");
    setErrorMsg("");
    setSheetOpen(true);
  };

  const handleAddEmployeeTitle = () => {
    const title = employeeTitleInput.trim();

    if (!title) return;
    if (title.includes("|")) {
      toast.error("Position titles cannot contain the | character.");
      return;
    }
    if (title.length > 80) {
      toast.error("Position titles must be 80 characters or fewer.");
      return;
    }
    if (employeeTitles.length >= 5) {
      toast.error("A staff member can have up to 5 position titles.");
      return;
    }
    if (employeeTitles.some((existing) => existing.toLowerCase() === title.toLowerCase())) {
      toast.error("This position title is already listed.");
      return;
    }

    setValue("employeeType", joinEmployeeTitles([...employeeTitles, title]), { shouldValidate: true });
    setEmployeeTitleInput("");
  };

  const handleRemoveEmployeeTitle = (titleToRemove: string) => {
    setValue(
      "employeeType",
      joinEmployeeTitles(employeeTitles.filter((title) => title !== titleToRemove)),
      { shouldValidate: true }
    );
  };

  // Submit form
  const onSubmit = async (values: StaffFormValues) => {
    try {
      setSubmitting(true);
      setErrorMsg("");

      const isEdit = !!editingStaff;
      const url = isEdit ? `/api/admin/staff/${editingStaff.id}` : "/api/admin/staff";
      const method = isEdit ? "PUT" : "POST";

      const selectedRole = dbRoles.find(r => r.id === values.roleId);
      const legacyRoleText = selectedRole?.is_system ? selectedRole.name : selectedRole?.base_role;
      if (legacyRoleText === "department_staff" && (!values.department || values.department === null)) {
        setErrorMsg("Clinical department is required for Department Staff.");
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
      setSheetOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setErrorMsg(message);
    } finally {
      setSubmitting(false);
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
      const res = await fetch(`/api/admin/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: targetStatus }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to update status");
      }

      // Update local state instantly
      setStaffList((prev) =>
        prev.map((s) => (s.id === staffId ? { ...s, is_active: targetStatus } : s))
      );
    } catch (err) {
      console.error(err);
    } finally {
      setConfirmDialog((prev) => ({ ...prev, open: false }));
    }
  };


  const assignableRoles = dbRoles.filter(
    (r) => !(r.is_system && r.name === "patient")
  );

  // Filter staff list based on search
  const filteredStaff = staffList.filter((s) => {
    const query = searchQuery.toLowerCase();
    return (
      s.full_name.toLowerCase().includes(query) ||
      s.email.toLowerCase().includes(query) ||
      s.role.toLowerCase().includes(query) ||
      (s.employee_type || "").toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Staff Management</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Create, update, and manage clinic personnel credentials and roles
          </p>
        </div>

        <Button onClick={handleCreateOpen} className="gap-2 bg-primary hover:bg-primary/90 text-white font-semibold">
          <Plus className="h-4 w-4" />
          Add Staff
        </Button>
      </div>

      {/* Main Table Card */}
      <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-lg">Personnel Registry</CardTitle>
            <CardDescription className="text-xs">
              System access control for administrative and clinical roles
            </CardDescription>
          </div>

          {/* Search bar */}
          <div className="relative w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search by name, email, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin text-accentBlue-600" />
              <span className="text-xs font-medium">Loading personnel registry...</span>
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="text-center py-16 text-slate-500 space-y-1">
              <p className="text-sm font-semibold">No staff members found</p>
              <p className="text-xs text-slate-400">Try adjusting your search query</p>
            </div>
          ) : (
            <Table>
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
                      className={`transition-opacity duration-150 ${!staff.is_active ? "opacity-60 bg-slate-50/30 dark:bg-slate-950/20" : ""}`}
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

                      {/* Email */}
                      <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                        {staff.email}
                      </TableCell>

                      {/* Role Badge */}
                      <TableCell>
                        <Badge className={`text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 ${ROLE_COLORS[staff.role] || "bg-slate-200 text-slate-800"}`}>
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
                          <span className="text-slate-400 font-mono text-xs">—</span>
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

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} disablePointerDismissal={true}>
        <SheetContent className="sm:max-w-md bg-white dark:bg-slate-900 overflow-y-auto">
          <SheetHeader className="pb-6 border-b border-slate-100 dark:border-slate-800">
            <SheetTitle>{editingStaff ? "Edit Staff Details" : "Add Staff Account"}</SheetTitle>
            <SheetDescription>
              {editingStaff
                ? "Update user profile. Authentication parameters are updated immediately."
                : "Create a new clinical or administrative staff member with role-based access."
              }
            </SheetDescription>
          </SheetHeader>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-6">
            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg dark:bg-rose-950/20 dark:border-rose-900/40 dark:text-rose-400 flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-xs font-semibold">Full Name</Label>
              <Input
                id="fullName"
                placeholder="e.g. Dr. Maria Santos"
                {...register("fullName")}
                className="text-xs"
              />
              {errors.fullName && (
                <p className="text-[10px] text-rose-500">{errors.fullName.message}</p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-semibold">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="maria.santos@bloodcare.com"
                {...register("email")}
                className="text-xs font-mono"
              />
              {errors.email && (
                <p className="text-[10px] text-rose-500">{errors.email.message}</p>
              )}
            </div>

            {/* Password (Only shown for creation) */}
            {!editingStaff ? (
              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs font-semibold">Temporary Password</Label>
                <div className="flex gap-2">
                  <Input
                    id="password"
                    type="text"
                    {...register("password")}
                    className="text-xs font-mono flex-1 bg-slate-50 dark:bg-slate-900/50"
                    readOnly
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const pwValue = watch("password") || "";
                      if (pwValue) {
                        navigator.clipboard.writeText(pwValue);
                        toast.success("Temporary password copied to clipboard!");
                      }
                    }}
                    className="px-3"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Make sure to share this password securely. The user should update it upon first login.
                </p>
                {errors.password && (
                  <p className="text-[10px] text-rose-500">{errors.password.message}</p>
                )}
              </div>
            ) : (
              // Reset Password Trigger (Only shown for edit)
              <div className="space-y-2 rounded-lg border border-slate-100 dark:border-slate-800 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Security</p>
                <div className="space-y-2 pt-2">
                  <Label className="text-xs font-semibold">Account Password</Label>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Administrators cannot view or change passwords. Click below to email a password recovery link to this user.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      try {
                        setSendingReset(true);
                        const res = await sendStaffResetEmailAction(editingStaff.email);
                        if (res.success) {
                          toast.success(`Password reset email sent to ${editingStaff.email}!`);
                        } else {
                          throw new Error(res.error || "Failed to send reset email.");
                        }
                      } catch (err: unknown) {
                        toast.error(err instanceof Error ? err.message : "Failed to send reset email.");
                      } finally {
                        setSendingReset(false);
                      }
                    }}
                    disabled={sendingReset}
                    className="w-full text-xs font-semibold gap-2 border-primary/30 text-primary hover:bg-primary/5"
                  >
                    {sendingReset ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending Email...
                      </>
                    ) : (
                      "Send Password Reset Email"
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Employee Position Titles */}
            <div className="space-y-2">
              <Label htmlFor="employeeTitleInput" className="text-xs font-semibold">Position(s) / Title(s)</Label>
              <input type="hidden" {...register("employeeType")} />
              <div className="flex gap-2">
                <Input
                  id="employeeTitleInput"
                  value={employeeTitleInput}
                  onChange={(event) => setEmployeeTitleInput(event.target.value.replace(/\|/g, ""))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleAddEmployeeTitle();
                    }
                  }}
                  placeholder="e.g. Billing Clerk"
                  maxLength={80}
                  className="text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddEmployeeTitle}
                  disabled={employeeTitles.length >= 5}
                  className="text-xs"
                >
                  Add
                </Button>
              </div>
              {employeeTitles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {employeeTitles.map((title) => (
                    <Badge
                      key={title}
                      variant="outline"
                      className="gap-1 border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                    >
                      {title}
                      <button
                        type="button"
                        onClick={() => handleRemoveEmployeeTitle(title)}
                        className="rounded-full text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                        aria-label={`Remove ${title}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Optional display labels only. System role still controls access permissions.
              </p>
              {errors.employeeType && (
                <p className="text-[10px] text-rose-500">{errors.employeeType.message}</p>
              )}
            </div>

            {/* Role Select */}
            <div className="space-y-2">
              <Label htmlFor="role" className="text-xs font-semibold">System Role</Label>
              <Select
                value={watchRoleId || undefined}
                onValueChange={(val) => {
                  setValue("roleId", val as string);
                  const selected = dbRoles.find(r => r.id === val);
                  const legacyRoleText = selected?.is_system ? selected.name : selected?.base_role;
                  if (legacyRoleText !== "department_staff") {
                    setValue("department", null as "laboratory" | "imaging" | "ultrasound" | "ecg" | null);
                  }
                }}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select a role">
                    {selectedRoleObj ? `${selectedRoleObj.name}${selectedRoleObj.is_system ? "" : " (Custom)"}` : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  {assignableRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-xs">
                      {r.name} {!r.is_system && "(Custom)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Department (Shown conditionally if role is department_staff) */}
            {isDeptStaff && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                <Label htmlFor="department" className="text-xs font-semibold">Clinical Department</Label>
                <Select
                  value={watch("department") || undefined}
                  onValueChange={(val) => setValue("department", val as StaffFormValues["department"])}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select clinical department" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <SelectItem value="laboratory" className="text-xs">Laboratory</SelectItem>
                    <SelectItem value="imaging" className="text-xs">Imaging (X-Ray)</SelectItem>
                    <SelectItem value="ultrasound" className="text-xs">Ultrasound</SelectItem>
                    <SelectItem value="ecg" className="text-xs">ECG</SelectItem>
                  </SelectContent>
                </Select>
                {errors.department && (
                  <p className="text-[10px] text-rose-500">{errors.department.message}</p>
                )}
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full mt-4 bg-primary hover:bg-primary/90 text-white font-semibold text-xs"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving Staff Member...
                </>
              ) : editingStaff ? (
                "Update Staff Member"
              ) : (
                "Create Staff Member"
              )}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

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
