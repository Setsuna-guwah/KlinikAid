"use client";

import React, { useState, useTransition, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginAction, resendConfirmationAction } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Lock, Mail, Loader2, KeyRound, ShieldAlert, CheckCircle, Info } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { focusRingClass } from "@/lib/focus-ring";

// Every `/login?error=<code>` producer in the app, mapped to an app-owned message.
// The query string is attacker-controllable, so an unknown code renders nothing
// rather than echoing the raw value back into the page.
const LOGIN_ERROR_MESSAGES = new Map<string, { title: string; description: string }>([
  [
    "account_deactivated",
    {
      title: "Account Deactivated",
      description: "Your account has been deactivated. Please contact the clinic.",
    },
  ],
  [
    "mfa_required",
    {
      title: "Verification Required",
      description:
        "Your session ended before two-factor verification was completed. Please sign in again.",
    },
  ],
  [
    "mfa_check_failed",
    {
      title: "Verification Unavailable",
      description:
        "We could not confirm your two-factor authentication status. Please sign in again.",
    },
  ],
]);

/**
 * Sign-in form state and submission: email/password, the resend-confirmation
 * branch for unconfirmed addresses, and the MFA code field that replaces the
 * credentials after a mfa_required status.
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = safeRedirectPath(searchParams.get("redirect"));
  const isResetSuccess = searchParams.get("reset") === "success";
  const isPrivacyDeclined = searchParams.get("notice") === "privacy_declined";
  const errorCode = searchParams.get("error");
  const loginNotice = errorCode ? LOGIN_ERROR_MESSAGES.get(errorCode) : undefined;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailUnconfirmed, setEmailUnconfirmed] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setEmailUnconfirmed(false);
    setResendNotice(null);

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
          setEmailUnconfirmed(result.status === "email_unconfirmed");
          return;
        }

        if (result.status === "mfa_required") {
          setMfaRequired(true);
          return;
        }

        if (result.success && result.redirectUrl) {
          // One navigation, one landing render. The action's reply has already
          // set the session cookies, so this RSC request carries them, and
          // Next 15 never serves a dynamic route from the client router cache
          // (staleTimes.dynamic defaults to 0), so a router.refresh() after it
          // can only re-render the landing a second time (#237). replace()
          // also keeps the login form out of the back history.
          router.replace(redirectPath || result.redirectUrl);
        }
      } catch {
        setError("Sign-in could not be completed. Please check your connection and try again.");
      }
    });
  };

  const handleResendConfirmation = () => {
    startTransition(async () => {
      try {
        const { message } = await resendConfirmationAction(email);
        setResendNotice(message);
      } catch {
        setResendNotice("A new link could not be requested. Please try again.");
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
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/10 dark:bg-primary/25 blur-[80px]" aria-hidden="true" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-500/5 dark:bg-emerald-500/20 blur-[80px]" aria-hidden="true" />

      <div className="w-full max-w-md z-10 space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center animate-fade-in">
          {/* Clinical Brand Logo */}
          <Image src="/icon.png" alt="KlinikAid" width={629} height={645} sizes="64px" className="w-16 rounded-xl mb-2 shadow-lg" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            KlinikAid
          </h1>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
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
            <CardContent className="space-y-4 pb-4">
              {loginNotice && (
                <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle className="font-semibold">{loginNotice.title}</AlertTitle>
                  <AlertDescription className="text-xs">{loginNotice.description}</AlertDescription>
                </Alert>
              )}

              {isResetSuccess && (
                <Alert className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300">
                  <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <AlertTitle className="font-semibold">Password Reset Success</AlertTitle>
                  <AlertDescription className="text-xs">
                    Your password has been successfully updated. You can now sign in with your new credentials.
                  </AlertDescription>
                </Alert>
              )}

              {isPrivacyDeclined && (
                <Alert className="bg-amber-50 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-900/50 text-amber-900 dark:text-amber-200">
                  <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <AlertTitle className="font-semibold">You have been signed out</AlertTitle>
                  <AlertDescription className="text-xs">
                    You did not accept the Data Privacy Agreement, so KlinikAid cannot process your data online.
                    Your account has not been deleted. Sign in again whenever you are ready to accept it, or contact
                    the Bloodcare reception desk for assistance.
                  </AlertDescription>
                </Alert>
              )}

              {error && (
                <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Sign-in Error</AlertTitle>
                  <AlertDescription>
                    {error}
                    {emailUnconfirmed && (
                      <div className="mt-2">
                        {resendNotice ? (
                          <p>{resendNotice}</p>
                        ) : (
                          <button
                            type="button"
                            onClick={handleResendConfirmation}
                            disabled={isPending}
                            className={`font-medium underline ${focusRingClass}`}
                          >
                            Send a new confirmation link
                          </button>
                        )}
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {!mfaRequired ? (
                // Email & Password Fields
                <>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
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
                      <Link href="/forgot-password" className="inline-flex items-center min-h-6 -my-1 text-xs text-accentBlue-600 dark:text-accentBlue-400 hover:underline">
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
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
                    <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="totpCode"
                      type="text"
                      autoComplete="one-time-code"
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
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-md shadow-primary/10 transition-all duration-200"
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
                  <Link href="/register" className="inline-flex items-center min-h-6 -my-1 text-accentBlue-600 dark:text-accentBlue-400 hover:underline">
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

/**
 * Login route. LoginForm reads the search params (redirect target, error and
 * notice codes), so the page renders it inside Suspense with a spinner until
 * hydration.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accentBlue-600 dark:text-accentBlue-400" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
