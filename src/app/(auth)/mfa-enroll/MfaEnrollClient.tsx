"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { verifyMfaFactorAction } from "./actions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert, KeyRound, Loader2, ArrowRight } from "lucide-react";
import Image from "next/image";
import { getPhoneFactors, getTotpFactors } from "@/lib/auth/mfa";

export default function MfaEnrollClient() {
  const router = useRouter();
  const supabase = createClient();

  const [qrCodeSvg, setQrCodeSvg] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;

    async function initializeMfa() {
      try {
        if (!active) return;
        setError(null);

        // 1. Check for existing factors and unenroll any unverified ones
        const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) {
          throw factorsError;
        }

        if (factorsData && active) {
          const unverifiedFactors = [
            ...getTotpFactors(factorsData).filter((f) => (f.status as string) === "unverified"),
            ...getPhoneFactors(factorsData).filter((f) => (f.status as string) === "unverified")
          ];

          // Await all unenroll calls to complete fully before enrolling
          await Promise.all(
            unverifiedFactors.map(async (factor) => {
              console.log(`[MFA] Cleaning up stale unverified factor: ${factor.id}`);
              const { error: unenrollError } = await supabase.auth.mfa.unenroll({
                factorId: factor.id
              });
              if (unenrollError) {
                console.warn(`[MFA] Failed to unenroll stale factor: ${unenrollError.message}`);
              }
            })
          );
        }

        if (!active) return;

        // 2. Start a fresh enrollment
        const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "KlinikAid"
        });

        if (enrollError || !enrollData) {
          // If we hit the friendly name conflict, try listing factors and cleaning them up one more time
          if (enrollError?.message?.includes("already exists")) {
            console.log("[MFA] Friendly name conflict detected, running secondary cleanup...");
            const { data: refetchData } = await supabase.auth.mfa.listFactors();
            if (refetchData) {
              const unverified = getTotpFactors(refetchData).filter((f) => (f.status as string) === "unverified");
              for (const f of unverified) {
                await supabase.auth.mfa.unenroll({ factorId: f.id });
              }
            }
            // Try enrolling one more time
            const { data: retryEnroll, error: retryError } = await supabase.auth.mfa.enroll({
              factorType: "totp",
              friendlyName: "KlinikAid"
            });
            if (retryError || !retryEnroll) {
              throw retryError || new Error("Failed to initialize MFA enrollment after retry.");
            }
            if (!active) return;
            setFactorId(retryEnroll.id);
            if (retryEnroll.totp) {
              setQrCodeSvg(retryEnroll.totp.qr_code);
              setSecret(retryEnroll.totp.secret);
            }
            return;
          }
          throw enrollError || new Error("Failed to initialize MFA enrollment.");
        }

        setFactorId(enrollData.id);
        if (enrollData.totp) {
          setQrCodeSvg(enrollData.totp.qr_code);
          setSecret(enrollData.totp.secret);
        }
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to set up authenticator: ${msg}`);
      } finally {
        if (active) {
          setIsInitializing(false);
        }
      }
    }

    initializeMfa();

    return () => {
      active = false;
    };
  }, [supabase]);

  const handleVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!factorId || !totpCode || totpCode.length !== 6) return;

    setError(null);
    startTransition(async () => {
      try {
        const res = await verifyMfaFactorAction(factorId, totpCode);
        if (res.error) {
          setError(res.error);
          return;
        }

        // Successfully enrolled and verified! Refresh and route to home.
        router.push("/");
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "An unexpected verification error occurred.");
      }
    });
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8 overflow-hidden">
      {/* Background clinical-theme decorative circles */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/10 blur-[80px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-500/5 blur-[80px]" />

      <div className="w-full max-w-lg z-10 space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Image src="/icon.png" alt="KlinikAid" width={64} height={64} className="rounded-xl mb-2 shadow-lg" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            KlinikAid
          </h1>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Security & MFA Setup
          </p>
        </div>

        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none backdrop-blur-sm bg-white/95 dark:bg-slate-900/95">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight text-center text-primary">
              Enroll Authenticator
            </CardTitle>
            <CardDescription className="text-center text-slate-500 dark:text-slate-400">
              Staff members must secure their account using two-factor authentication
            </CardDescription>
          </CardHeader>

          {isInitializing ? (
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-slate-500">Generating secure QR code keys...</p>
            </CardContent>
          ) : (
            <form onSubmit={handleVerify}>
              <CardContent className="space-y-5">
                {error && (
                  <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>Configuration Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-col md:flex-row items-center md:items-start gap-6 py-2">
                  {/* Render the QR code SVG directly as a data URL in img */}
                  {qrCodeSvg && (
                    <div className="flex flex-col items-center justify-center p-3 bg-white border border-slate-200 rounded-xl shadow-sm w-[170px] h-[170px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img 
                        src={qrCodeSvg} 
                        alt="TOTP MFA QR Code" 
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}

                  <div className="flex-1 space-y-3 text-sm text-slate-600 dark:text-slate-400">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      To complete setup:
                    </p>
                    <ol className="list-decimal pl-5 space-y-2">
                      <li>Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.).</li>
                      <li>
                        If you cannot scan, manually enter the setup key:
                        <code className="block mt-1 p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-mono font-bold rounded break-all tracking-wider text-center select-all">
                          {secret}
                        </code>
                      </li>
                      <li>Enter the 6-digit verification code below.</li>
                    </ol>
                  </div>
                </div>

                <div className="space-y-2 border-t border-slate-100 dark:border-slate-800/80 pt-4">
                  <Label htmlFor="code" className="font-bold">6-Digit Verification Code</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="code"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="123456"
                      className="pl-10 text-center tracking-widest font-mono text-lg font-bold"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                      disabled={isPending}
                      required
                    />
                  </div>
                </div>
              </CardContent>

              <CardFooter className="flex flex-col space-y-3">
                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90 text-white font-medium shadow-md shadow-primary/10 transition-all duration-200"
                  disabled={isPending || totpCode.length !== 6}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enabling MFA...
                    </>
                  ) : (
                    <>
                      Verify & Activate
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-sm text-slate-500 hover:text-slate-800"
                  onClick={handleSignOut}
                  disabled={isPending}
                >
                  Sign out and return to login
                </Button>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
