"use client";

import React, { useState, useTransition, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginAction } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Activity, Lock, Mail, Loader2, KeyRound, ShieldAlert } from "lucide-react";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.append("email", email);
      formData.append("password", password);
      if (mfaRequired && totpCode) {
        formData.append("totpCode", totpCode);
      }

      try {
        const result = await loginAction(null, formData);

        if (!result) {
          setError("Sign-in did not complete. Please try again.");
          return;
        }

        if (result.error) {
          setError(result.error);
          return;
        }

        if (result.status === "mfa_required") {
          setMfaRequired(true);
          return;
        }

        if (result.success && result.redirectUrl) {
          // Force a full router refresh or hard redirect to ensure cookies take effect
          router.push(redirectPath || result.redirectUrl);
          router.refresh();
        }
      } catch {
        setError("Sign-in could not be completed. Please check your connection and try again.");
      }
    });
  };

  const handleBackToLogin = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setMfaRequired(false);
    setTotpCode("");
    setError(null);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8 overflow-hidden">
      {/* Background clinical-theme decorative circles */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/10 blur-[80px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-500/5 blur-[80px]" />

      <div className="w-full max-w-md z-10 space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center animate-fade-in">
          {/* Clinical Brand Logo */}
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-white shadow-lg shadow-primary/20 mb-2">
            <Activity className="h-6 w-6 stroke-[2.5]" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            KlinikAid
          </h1>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Bloodcare Medical Laboratory
          </p>
        </div>

        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none backdrop-blur-sm bg-white/95 dark:bg-slate-900/95">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight text-center">
              {mfaRequired ? "Verify Identity" : "Portal Sign In"}
            </CardTitle>
            <CardDescription className="text-center text-slate-500 dark:text-slate-400">
              {mfaRequired
                ? "Enter the 6-digit verification code from your authenticator app"
                : "Enter your credentials to access your dashboard"}
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Sign-in Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {!mfaRequired ? (
                // Email & Password Fields
                <>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="doctor@bloodcare.com"
                        className="pl-10"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={isPending}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        className="pl-10"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isPending}
                        required
                      />
                    </div>
                  </div>
                </>
              ) : (
                // MFA Verification Input
                <div className="space-y-2">
                  <Label htmlFor="totpCode">Authentication Code</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="totpCode"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="123456"
                      className="pl-10 text-center tracking-widest font-mono text-lg"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                      disabled={isPending}
                      required
                      autoFocus
                    />
                  </div>
                </div>
              )}
            </CardContent>

            <CardFooter className="flex flex-col space-y-4">
              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 text-white font-medium shadow-md shadow-primary/10 transition-all duration-200"
                disabled={isPending}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Please wait...
                  </>
                ) : mfaRequired ? (
                  "Verify & Log In"
                ) : (
                  "Sign In"
                )}
              </Button>

              {!mfaRequired && (
                <div className="text-sm text-center text-slate-500 dark:text-slate-400 mt-2">
                  Don&apos;t have an account?{" "}
                  <Link href="/register" className="text-accentBlue-600 hover:underline">
                    Sign Up
                  </Link>
                </div>
              )}

              {mfaRequired && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-sm text-slate-500 hover:text-slate-800"
                  onClick={handleBackToLogin}
                  disabled={isPending}
                >
                  Back to login
                </Button>
              )}
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accentBlue-600" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
