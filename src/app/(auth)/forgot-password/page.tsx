"use client";

import React, { useState, useTransition } from "react";
import { forgotPasswordAction } from "./actions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Mail, Loader2, ArrowLeft, CheckCircle } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default function ForgotPasswordPage() {
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      try {
        const result = await forgotPasswordAction(null, formData);
        if (result.error) {
          setError(result.error);
        } else if (result.success) {
          setSuccess(true);
        }
      } catch {
        setError("An unexpected error occurred. Please try again.");
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
              Reset Password
            </CardTitle>
            <CardDescription className="text-center text-slate-500 dark:text-slate-400">
              Enter your email address to receive password recovery instructions
            </CardDescription>
          </CardHeader>

          {success ? (
            <CardContent className="space-y-4 pt-4">
              <Alert className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/50">
                <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <AlertTitle className="text-emerald-800 dark:text-emerald-300 font-semibold">Check your inbox</AlertTitle>
                <AlertDescription className="text-emerald-700 dark:text-emerald-400 text-xs">
                  If an account exists for this email, we have sent password reset instructions. Please check your inbox and spam folder.
                </AlertDescription>
              </Alert>
              <div className="text-center pt-2">
                <Link href="/login" className="inline-flex items-center gap-2 text-sm text-accentBlue-600 hover:underline">
                  <ArrowLeft className="h-4 w-4" /> Back to Sign In
                </Link>
              </div>
            </CardContent>
          ) : (
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="user@bloodcare.com"
                      className="pl-10"
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
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>

                <div className="text-sm text-center">
                  <Link href="/login" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 hover:underline">
                    <ArrowLeft className="h-4 w-4" /> Back to Sign In
                  </Link>
                </div>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
