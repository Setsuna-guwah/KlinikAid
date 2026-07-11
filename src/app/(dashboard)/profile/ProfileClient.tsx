"use client";

import React, { useState, useTransition } from "react";
import { changePasswordAction, updatePatientDetailsAction } from "./actions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Lock, Loader2, MapPin, Phone, ShieldCheck, User } from "lucide-react";
import { toast } from "sonner";
import { USER_ROLES, DEPARTMENTS } from "@/lib/constants";
import { PASSWORD_REQUIREMENT_TEXT } from "@/lib/validation";
import { UserRole, Department } from "@/types";

interface ProfileClientProps {
  user: {
    fullName: string;
    email: string;
    role: UserRole;
    department: Department | null;
  };
  patient: {
    contactNumber: string;
    address: string;
    dateOfBirth: string;
    gender: string;
  } | null;
}

export default function ProfileClient({ user, patient }: ProfileClientProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [contactNumber, setContactNumber] = useState(patient?.contactNumber || "");
  const [address, setAddress] = useState(patient?.address || "");
  const [error, setError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDetailsPending, startDetailsTransition] = useTransition();

  const roleConfig = USER_ROLES[user.role];
  const deptConfig = user.department ? DEPARTMENTS[user.department] : null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.append("password", password);
    formData.append("confirmPassword", confirmPassword);

    startTransition(async () => {
      try {
        const result = await changePasswordAction(null, formData);
        if (result.error) {
          setError(result.error);
        } else if (result.success) {
          toast.success("Password changed successfully!");
          setPassword("");
          setConfirmPassword("");
        }
      } catch {
        setError("An unexpected error occurred. Please try again.");
      }
    });
  };

  const handleDetailsSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDetailsError(null);

    const formData = new FormData();
    formData.append("contactNumber", contactNumber);
    formData.append("address", address);

    startDetailsTransition(async () => {
      try {
        const result = await updatePatientDetailsAction(null, formData);
        if (result.error) {
          setDetailsError(result.error);
        } else if (result.success) {
          toast.success("Profile details updated successfully!");
        }
      } catch {
        setDetailsError("An unexpected error occurred. Please try again.");
      }
    });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Account Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Manage your security settings and view your account information
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Info Column */}
        <div className="md:col-span-1 space-y-6">
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900">
            <CardHeader className="flex flex-col items-center pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-3">
                <User className="h-8 w-8" />
              </div>
              <CardTitle className="text-lg text-center font-bold">{user.fullName}</CardTitle>
              <CardDescription className="text-xs font-mono">{user.email}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4 text-sm">
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-500 dark:text-slate-400 font-medium">System Role</span>
                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${roleConfig?.color || "bg-slate-100 text-slate-800"}`}>
                  {roleConfig?.label || user.role}
                </span>
              </div>
              {user.department && (
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">Department</span>
                  <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${deptConfig?.color || "bg-slate-100"}`}>
                    {deptConfig?.label}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Details / Security Column */}
        <div className="md:col-span-2 space-y-6">
          {patient && (
            <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900">
              <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5 text-accentBlue-500" />
                  <CardTitle className="text-lg">Patient Details</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Update contact details. Name, birth date, and gender remain read-only clinic records.
                </CardDescription>
              </CardHeader>

              <form onSubmit={handleDetailsSubmit}>
                <CardContent className="space-y-4 pt-6">
                  {detailsError && (
                    <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
                      <AlertTitle>Error</AlertTitle>
                      <AlertDescription>{detailsError}</AlertDescription>
                    </Alert>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Date of Birth</Label>
                      <Input value={patient.dateOfBirth || "Not available"} disabled className="text-xs" />
                    </div>
                    <div className="space-y-2">
                      <Label>Gender</Label>
                      <Input value={patient.gender || "Not available"} disabled className="text-xs capitalize" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contactNumber">Contact Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="contactNumber"
                        type="tel"
                        className="pl-10"
                        value={contactNumber}
                        onChange={(e) => setContactNumber(e.target.value)}
                        disabled={isDetailsPending}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="address"
                        type="text"
                        className="pl-10"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        disabled={isDetailsPending}
                        required
                      />
                    </div>
                  </div>
                </CardContent>

                <CardFooter className="border-t border-slate-100 dark:border-slate-800 pt-4 flex justify-end">
                  <Button
                    type="submit"
                    className="bg-primary hover:bg-primary/90 text-white font-semibold text-xs"
                    disabled={isDetailsPending}
                  >
                    {isDetailsPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Details"
                    )}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          )}

          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900">
            <CardHeader className="border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                <CardTitle className="text-lg">Update Password</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Change your account password.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4 pt-6">
                {error && (
                  <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Minimum 8 characters"
                      className="pl-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isPending}
                      required
                    />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {PASSWORD_REQUIREMENT_TEXT}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="••••••••"
                      className="pl-10"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={isPending}
                      required
                    />
                  </div>
                </div>
              </CardContent>

              <CardFooter className="border-t border-slate-100 dark:border-slate-800 pt-4 flex justify-end">
                <Button
                  type="submit"
                  className="bg-primary hover:bg-primary/90 text-white font-semibold text-xs"
                  disabled={isPending}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
