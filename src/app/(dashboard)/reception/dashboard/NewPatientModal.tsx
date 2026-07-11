"use client";

import React, { useState, useTransition } from "react";
import { createPatientByStaffAction } from "./actions";
import { 
  Dialog, 
  DialogTrigger, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { 
  UserPlus, 
  Loader2, 
  ShieldAlert, 
  Copy, 
  CheckCircle2,
  Check,
  User,
  Mail,
  Calendar,
  Phone,
  MapPin
} from "lucide-react";
import { validateAge } from "@/lib/validation";

export default function NewPatientModal() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [formData, setFormData] = useState({
    email: "",
    firstName: "",
    lastName: "",
    dob: "",
    gender: "male",
    contactNumber: "",
    address: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleCopyPassword = () => {
    navigator.clipboard.writeText(generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const dobValidation = formData.dob ? validateAge(formData.dob) : { valid: true };

  const resetForm = () => {
    setFormData({
      email: "",
      firstName: "",
      lastName: "",
      dob: "",
      gender: "male",
      contactNumber: "",
      address: "",
    });
    setError(null);
    setSuccess(false);
    setGeneratedPassword("");
    setCopied(false);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const data = new FormData();
      Object.entries(formData).forEach(([key, val]) => {
        data.append(key, val);
      });

      try {
        const result = await createPatientByStaffAction(null, data);
        if (result.error) {
          setError(result.error);
          return;
        }

        if (result.success) {
          setSuccess(true);
          setGeneratedPassword(result.passwordUsed || "");
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "An unexpected error occurred. Please try again.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val);
      if (!val) resetForm();
    }} disablePointerDismissal={true}>
      <DialogTrigger render={
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1.5 shadow-sm">
          <UserPlus className="h-4 w-4" />
          New Patient
        </Button>
      } />
      
      <DialogContent 
        className="sm:max-w-md max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Register New Patient</DialogTitle>
          <DialogDescription>
            Create a patient account on their behalf.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          // Success Screen displaying per-patient random password
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center justify-center text-center space-y-2">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 animate-bounce" />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Account Created Successfully</h3>
              <p className="text-xs text-slate-500 max-w-xs">
                A profile has been registered. Provide the temporary credentials to the patient.
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-lg border border-slate-100 dark:border-slate-800 space-y-3">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Patient Email</span>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{formData.email}</p>
              </div>
              
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Temporary Password</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 block p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded font-mono text-sm select-all">
                    {generatedPassword}
                  </code>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="icon" 
                    onClick={handleCopyPassword}
                    className="h-9 w-9 shrink-0"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter>
              <DialogClose render={
                <Button className="w-full bg-primary hover:bg-primary/90 text-white">
                  Close Window
                </Button>
              } />
            </DialogFooter>
          </div>
        ) : (
          // Registration Form
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Operation Failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {formData.dob && !dobValidation.valid && (
              <Alert variant="destructive" className="bg-amber-50 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-900/50">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Date of Birth Check</AlertTitle>
                <AlertDescription>{dobValidation.error}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="firstName">First Name</Label>
                <div className="relative">
                  <User className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    id="firstName"
                    type="text"
                    className="pl-8 text-xs h-9"
                    placeholder="John"
                    value={formData.firstName}
                    onChange={handleChange}
                    disabled={isPending}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="lastName">Last Name</Label>
                <div className="relative">
                  <User className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    id="lastName"
                    type="text"
                    className="pl-8 text-xs h-9"
                    placeholder="Doe"
                    value={formData.lastName}
                    onChange={handleChange}
                    disabled={isPending}
                    required
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="dob">Date of Birth</Label>
                <div className="relative">
                  <Calendar className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    id="dob"
                    type="date"
                    className="pl-8 text-xs h-9"
                    value={formData.dob}
                    onChange={handleChange}
                    disabled={isPending}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="gender">Gender</Label>
                <select
                  id="gender"
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:ring-offset-slate-950 dark:focus-visible:ring-slate-300"
                  value={formData.gender}
                  onChange={handleChange}
                  disabled={isPending}
                  required
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="contactNumber">Contact Number</Label>
              <div className="relative">
                <Phone className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  id="contactNumber"
                  type="tel"
                  className="pl-8 text-xs h-9"
                  placeholder="09171234567"
                  value={formData.contactNumber}
                  onChange={handleChange}
                  disabled={isPending}
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="address">Address</Label>
              <div className="relative">
                <MapPin className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  id="address"
                  type="text"
                  className="pl-8 text-xs h-9"
                  placeholder="123 Rizal St, Rodriguez, Rizal"
                  value={formData.address}
                  onChange={handleChange}
                  disabled={isPending}
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  className="pl-8 text-xs h-9"
                  placeholder="patient@gmail.com"
                  value={formData.email}
                  onChange={handleChange}
                  disabled={isPending}
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 text-white font-medium h-9 text-xs"
                disabled={isPending}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Create Account"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
