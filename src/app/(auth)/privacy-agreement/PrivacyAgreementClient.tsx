"use client";

import React, { useState, useRef, useEffect, useTransition } from "react";
import { acceptPrivacyAction } from "./actions";
import { logoutAction } from "@/app/(auth)/logout/actions";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Loader2 } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";

export default function PrivacyAgreementClient() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDisagreeing, startDisagreeTransition] = useTransition();
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [isCheckboxChecked, setIsCheckboxChecked] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleDisagree = () => {
    startDisagreeTransition(async () => {
      try {
        await logoutAction();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to sign out.");
      }
    });
  };

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Detect if scrolled to bottom with 15px tolerance
    const isAtBottom =
      container.scrollHeight - container.scrollTop <= container.clientHeight + 15;
    
    if (isAtBottom) {
      setHasScrolledToBottom(true);
    }
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      // Check initially if content fits without scrolling
      if (container.scrollHeight <= container.clientHeight) {
        setHasScrolledToBottom(true);
      }
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCheckboxChecked || !hasScrolledToBottom) return;

    startTransition(async () => {
      try {
        const res = await acceptPrivacyAction();
        if (res.error) {
          toast.error(res.error);
        } else {
          toast.success("Privacy agreement accepted successfully!");
          // Force hard reload or full router push to ensure middleware / layout re-evaluates
          router.push("/patient/dashboard");
          router.refresh();
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    });
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8 overflow-y-auto">
      {/* Background clinical-theme decorative circles */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/10 blur-[80px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-500/5 blur-[80px] pointer-events-none" />

      <div className="w-full max-w-2xl z-10 space-y-6 my-8">
        <div className="flex flex-col items-center space-y-2 text-center">
          {/* Clinical Brand Logo */}
          <Image src="/icon.png" alt="KlinikAid" width={64} height={64} className="rounded-xl mb-2 shadow-lg" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">KlinikAid</h1>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Bloodcare Medical Laboratory</p>
        </div>

        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm">
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2 justify-center mb-2">
              <ShieldCheck className="h-6 w-6 text-emerald-500" />
              <CardTitle className="text-2xl font-bold tracking-tight">Data Privacy Agreement</CardTitle>
            </div>
            <CardDescription className="text-center text-slate-500 dark:text-slate-400">
              Please read and accept the following agreement under Republic Act No. 10173.
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div 
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="h-80 overflow-y-auto p-4 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-650 dark:text-slate-350 space-y-4 leading-relaxed scrollbar-thin select-none"
              >
                <h4 className="font-bold text-sm text-slate-900 dark:text-white">Republic Act No. 10173 (Data Privacy Act of 2012) Consent</h4>
                
                <p>
                  Welcome to KlinikAid, the internal clinic management web portal for Bloodcare Medical Laboratory (located in Burgos, Rodriguez, Rizal). We are committed to protecting your personal and medical information in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173) of the Philippines.
                </p>
                
                <h5 className="font-semibold text-slate-850 dark:text-slate-200 text-xs">1. Information We Collect</h5>
                <p>
                  To provide clinical services and allow secure digital access to your diagnostic results, we collect and process the following data points:
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong>Personal Identification Details:</strong> Full Name, Date of Birth, Gender, and Address.</li>
                  <li><strong>Contact Information:</strong> Contact Number and Email Address.</li>
                  <li><strong>Medical Records:</strong> Laboratory referral slips, test results, physician information, and basic vitals (blood pressure, temperature, weight).</li>
                </ul>

                <h5 className="font-semibold text-slate-850 dark:text-slate-200 text-xs">2. Purpose of Collection</h5>
                <p>
                  Your information is collected and processed solely for the following purposes:
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Validating and approving submitted laboratory documents.</li>
                  <li>Routing your record to the appropriate clinical departments (Laboratory, Imaging, Ultrasound, ECG).</li>
                  <li>Generating longitudinal charts and medical records accessible by your medical specialist.</li>
                  <li>Providing access to our AI Assistant chatbot for basic clinic inquiry services.</li>
                </ul>

                <h5 className="font-semibold text-slate-850 dark:text-slate-200 text-xs">3. Information Security & Storage</h5>
                <p>
                  Your data is encrypted in transit and at rest, stored securely using Supabase database infrastructure. Uploaded medical documents are kept in private, restricted-access storage buckets. Only authorized medical specialists, receptionist staff, and clinical department personnel can view your data, governed strictly by Role-Based Access Control (RBAC). We will not share your records with external third parties without your explicit request or a lawful subpoena.
                </p>

                <h5 className="font-semibold text-slate-850 dark:text-slate-200 text-xs">4. Your Rights under RA 10173</h5>
                <p>
                  As a data subject, you hold the right to be informed of collection, object to processing, access your clinical logs, request corrections of discrepancies, and withdraw consent.
                </p>
                
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  By scrolling to the bottom of this page, checking the consent box, and clicking &quot;Accept &amp; Continue&quot;, you grant Bloodcare Medical Laboratory consent to collect, store, and process your personal and medical data as described above.
                </p>
              </div>

              <div className="flex items-start gap-2 pt-2">
                <input
                  id="privacyConsent"
                  type="checkbox"
                  checked={isCheckboxChecked}
                  onChange={(e) => setIsCheckboxChecked(e.target.checked)}
                  disabled={!hasScrolledToBottom}
                  className="mt-1 h-4 w-4 rounded border-slate-350 text-accentBlue-600 focus:ring-accentBlue-500 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  required
                />
                <label 
                  htmlFor="privacyConsent" 
                  className={`text-xs select-none ${
                    hasScrolledToBottom 
                      ? "text-slate-700 dark:text-slate-300 cursor-pointer" 
                      : "text-slate-400 dark:text-slate-650 cursor-not-allowed"
                  }`}
                >
                  {hasScrolledToBottom 
                    ? "I have read and fully accept the Data Privacy Agreement (RA 10173) terms."
                    : "Please scroll to the bottom of the agreement text to enable acceptance."}
                </label>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col space-y-2">
              <Button
                type="submit"
                disabled={!isCheckboxChecked || !hasScrolledToBottom || isPending || isDisagreeing}
                className="w-full bg-primary hover:bg-primary/90 text-white font-medium shadow-md shadow-primary/10 transition-all duration-200"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving Acceptance...
                  </>
                ) : (
                  "Accept & Continue"
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleDisagree}
                disabled={isPending || isDisagreeing}
                className="w-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-all"
              >
                {isDisagreeing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing Out...
                  </>
                ) : (
                  "I Do Not Agree"
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
