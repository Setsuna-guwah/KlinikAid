"use client";

import React, { useState, useTransition, Suspense } from "react";
import { useRouter } from "next/navigation";
import { registerAction } from "./actions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert, Loader2, User, Mail, Lock, Phone, Calendar, MapPin, MailCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { PASSWORD_REQUIREMENT_TEXT, validateAge, validatePassword } from "@/lib/validation";
import TermsAndConditionsModal from "@/components/TermsAndConditionsModal";

function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [hasReadTerms, setHasReadTerms] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
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

  const dobValidation = formData.dob ? validateAge(formData.dob) : { valid: true };
  const passwordError =
    passwordTouched && formData.password && !validatePassword(formData.password)
      ? PASSWORD_REQUIREMENT_TEXT
      : null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setEmailPending(null);

    startTransition(async () => {
      const data = new FormData();
      Object.entries(formData).forEach(([key, val]) => {
        data.append(key, val);
      });
      data.append("acceptedTerms", acceptedTerms ? "true" : "false");

      try {
        const result = await registerAction(null, data);
        if (result.error) {
          setError(result.error);
          return;
        }

        if (result.emailPending && result.registeredEmail) {
          setError(null);
          setEmailPending(result.registeredEmail);
          return;
        }

        if (result.success && result.redirectUrl) {
          router.push(result.redirectUrl);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "An unexpected error occurred. Please try again.");
      }
    });
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8 overflow-y-auto">
      {/* Background clinical-theme decorative circles */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/10 blur-[80px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-500/5 blur-[80px] pointer-events-none" />

      <div className="w-full max-w-xl z-10 space-y-6 my-8">
        <div className="flex flex-col items-center space-y-2 text-center">
          {/* Clinical Brand Logo */}
          <Image src="/icon.png" alt="KlinikAid" width={64} height={64} className="rounded-xl mb-2 shadow-lg" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            KlinikAid
          </h1>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Create Your Patient Account
          </p>
        </div>

        {emailPending ? (
          <Card className="border border-emerald-200/80 dark:border-emerald-800 shadow-xl shadow-slate-200/50 dark:shadow-none bg-white/95 dark:bg-slate-900/95">
            <CardContent className="pt-8 pb-8 flex flex-col items-center space-y-4 text-center">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-950/40">
                <MailCheck className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Check your email
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  We sent a confirmation link to{" "}
                  <strong className="text-slate-700 dark:text-slate-300">{emailPending}</strong>.
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Confirm to activate your account, then{" "}
                  <Link href="/login" className="text-accentBlue-600 hover:underline font-medium">
                    log in here
                  </Link>
                  .
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none bg-white/95 dark:bg-slate-900/95">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold tracking-tight text-center">
                Patient Registration
              </CardTitle>
              <CardDescription className="text-center text-slate-500 dark:text-slate-400">
                Provide your details below to register for the portal
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>Registration Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Two Column Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="firstName"
                        type="text"
                        placeholder="John"
                        className="pl-10"
                        value={formData.firstName}
                        onChange={handleChange}
                        disabled={isPending}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="lastName"
                        type="text"
                        placeholder="Doe"
                        className="pl-10"
                        value={formData.lastName}
                        onChange={handleChange}
                        disabled={isPending}
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dob">Date of Birth</Label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="dob"
                        type="date"
                        className={`pl-10 ${formData.dob && !dobValidation.valid ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                        value={formData.dob}
                        onChange={handleChange}
                        disabled={isPending}
                        required
                      />
                    </div>
                    {formData.dob && !dobValidation.valid && (
                      <p className="text-xs font-medium text-red-600 dark:text-red-400">
                        {dobValidation.error}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="gender">Gender</Label>
                    <select
                      id="gender"
                      className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:ring-offset-slate-950 dark:focus-visible:ring-slate-300"
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

                <div className="space-y-2">
                  <Label htmlFor="contactNumber">Contact Number</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="contactNumber"
                      type="tel"
                      placeholder="09171234567"
                      className="pl-10"
                      value={formData.contactNumber}
                      onChange={handleChange}
                      disabled={isPending}
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
                      placeholder="123 Rizal St, Rodriguez, Rizal"
                      className="pl-10"
                      value={formData.address}
                      onChange={handleChange}
                      disabled={isPending}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="john.doe@example.com"
                      className="pl-10"
                      value={formData.email}
                      onChange={handleChange}
                      disabled={isPending}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      className="pl-10"
                      value={formData.password}
                      onChange={handleChange}
                      onBlur={() => setPasswordTouched(true)}
                      disabled={isPending}
                      required
                    />
                  </div>
                  <p className={`text-xs ${passwordError ? "font-medium text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}>
                    {passwordError || PASSWORD_REQUIREMENT_TEXT}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40 p-4 space-y-2">
                  <div className="grid grid-cols-[1rem_1fr] items-start gap-3">
                    <input
                      id="acceptedTerms"
                      type="checkbox"
                      checked={acceptedTerms}
                      onChange={(e) => setAcceptedTerms(e.target.checked)}
                      disabled={!hasReadTerms || isPending}
                      required
                      className="mt-1 h-4 w-4 min-h-4 min-w-4 shrink-0 rounded border-slate-400 text-accentBlue-600 focus:ring-accentBlue-500 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <div
                      className={`text-xs leading-relaxed select-none ${
                        hasReadTerms
                          ? "text-slate-700 dark:text-slate-300"
                          : "text-slate-500 dark:text-slate-500"
                      }`}
                    >
                      I accept the KlinikAid{" "}
                      <button
                        type="button"
                        onClick={() => setIsTermsModalOpen(true)}
                        className="font-semibold text-accentBlue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-accentBlue-500/40 rounded-sm"
                      >
                        Terms and Conditions
                      </button>
                      .
                    </div>
                  </div>
                  {!hasReadTerms && (
                    <p className="pl-7 text-xs text-slate-500 dark:text-slate-400">
                      Please open and scroll through the Terms and Conditions before accepting.
                    </p>
                  )}
                </div>

              </CardContent>

              <CardFooter className="flex flex-col space-y-4">
                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90 text-white font-medium shadow-md shadow-primary/10 transition-all duration-200"
                  disabled={isPending || !acceptedTerms}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Registering...
                    </>
                  ) : (
                    "Create Account"
                  )}
                </Button>

                <div className="text-sm text-center text-slate-500 dark:text-slate-400">
                  Already have an account?{" "}
                  <Link href="/login" className="text-accentBlue-600 hover:underline">
                    Sign In
                  </Link>
                </div>
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
      <TermsAndConditionsModal
        open={isTermsModalOpen}
        onOpenChange={setIsTermsModalOpen}
        onReadComplete={() => setHasReadTerms(true)}
      />
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accentBlue-600" />
      </div>
    }>
      <RegisterForm />
    </Suspense>
  );
}
