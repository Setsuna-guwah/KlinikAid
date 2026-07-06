"use client";

import React, { useState, useEffect, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Lock, Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [tokenHash, setTokenHash] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCheckingParams, setIsCheckingParams] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // Read parameters from URL search params client-side
    const searchParams = new URLSearchParams(window.location.search);
    const urlTokenHash = searchParams.get("token_hash");
    
    // Read any explicit redirect errors from Supabase
    const urlError = searchParams.get("error_description") || searchParams.get("error");
    if (urlError) {
      setError(urlError);
    }
    
    if (urlTokenHash) {
      setTokenHash(urlTokenHash);
    }
    
    setIsCheckingParams(false);
  }, []);

  const verifyTriggered = useRef(false);

  const handleStartVerify = async () => {
    if (!tokenHash || isVerifying || isVerified || verifyTriggered.current) return;
    setError(null);
    setIsVerifying(true);
    verifyTriggered.current = true;

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "recovery",
      });

      if (verifyError) {
        setError(verifyError.message);
        setIsVerifying(false);
        verifyTriggered.current = false;
        return;
      }
      setIsVerified(true);
    } catch {
      setError("Failed to establish a recovery session. Please request a new link.");
      verifyTriggered.current = false;
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    startTransition(async () => {
      try {
        const { error: updateError } = await supabase.auth.updateUser({
          password: password,
        });

        if (updateError) {
          setError(updateError.message);
          return;
        }

        // Sign out to clear any recovery session context cleanly
        await supabase.auth.signOut();
        router.push("/login?reset=success");
      } catch {
        setError("Failed to update password. Please try again.");
      }
    });
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8 overflow-hidden">
      {/* Background clinical-theme decorative circles */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/10 blur-[80px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-500/5 blur-[80px]" />

      <div className="w-full max-w-md z-10 space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center animate-fade-in">
          {/* Clinical Brand Logo */}
          <Image src="/icon.png" alt="KlinikAid" width={64} height={64} className="rounded-xl mb-2 shadow-lg" />
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
              {(!tokenHash || error) ? "Invalid Session" : !isVerified ? "Reset Password" : "Create New Password"}
            </CardTitle>
            <CardDescription className="text-center text-slate-500 dark:text-slate-400">
              {(!tokenHash || error)
                ? "There was a problem with your password reset request"
                : !isVerified
                ? "Confirm your request to begin setting up a new secure password"
                : "Provide a new secure password for your account"}
            </CardDescription>
          </CardHeader>

          {isCheckingParams ? (
            <CardContent className="flex flex-col items-center justify-center py-10 gap-3 text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-xs font-medium">Validating recovery session...</span>
            </CardContent>
          ) : (!tokenHash || error) ? (
            <CardContent className="space-y-4 pt-4">
              <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Error Details</AlertTitle>
                <AlertDescription className="text-xs">
                  {error || "This password reset link is invalid, has expired, or was accessed directly."}
                </AlertDescription>
              </Alert>
              <div className="text-center pt-2">
                <Link href="/forgot-password" className="text-sm text-accentBlue-600 hover:underline">
                  Request a new reset link
                </Link>
              </div>
            </CardContent>
          ) : !isVerified ? (
            <>
              <CardContent className="space-y-4 pt-4 text-center">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800/80 text-sm text-slate-600 dark:text-slate-400">
                  Click the button below to authorize the password recovery session on this browser window.
                </div>
              </CardContent>
              <CardFooter className="flex flex-col space-y-4">
                <Button
                  onClick={handleStartVerify}
                  className="w-full bg-primary hover:bg-primary/90 text-white font-medium shadow-md shadow-primary/10 transition-all duration-200"
                  disabled={isVerifying}
                >
                  {isVerifying ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Authorizing recovery session...
                    </>
                  ) : (
                    "Authorize & Reset Password"
                  )}
                </Button>
              </CardFooter>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
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
                      autoFocus
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
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

              <CardFooter className="flex flex-col space-y-4">
                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90 text-white font-medium shadow-md shadow-primary/10 transition-all duration-200"
                  disabled={isPending}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving password...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
