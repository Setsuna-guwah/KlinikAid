"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollText } from "lucide-react";

const TERMS_AND_CONDITIONS_TEXT = `
KlinikAid — Terms and Conditions

Last updated: [DEPLOYMENT DATE]

Please read these Terms and Conditions carefully before using the KlinikAid web portal operated by Bloodcare Medical Laboratory. By creating an account or using the portal, you agree to be bound by these terms. If you do not agree, please do not use the portal.


1. ACCEPTANCE OF TERMS

By registering for and using KlinikAid, you confirm that you are at least 18 years old and that you have the legal capacity to enter into these terms.


2. DESCRIPTION OF SERVICE

KlinikAid is a patient-facing web portal that allows you to:
  - Submit medical documents to Bloodcare Medical Laboratory by uploading PDF files or image files through the web portal
  - View your queue position for laboratory services
  - View your laboratory records and results
  - Ask general questions through an AI assistant
  - Manage your patient profile

Staff members may use the portal to view patient information according to their authorized role. All account and record management is performed by authorized clinic personnel.


3. MEDICAL DISCLAIMER

KlinikAid is a tool for managing laboratory services and does NOT provide medical advice, diagnosis, or treatment.

  - The AI assistant provides general information only and is not a substitute for professional medical advice. Never rely on the AI assistant for medical decisions.
  - Document quality assessment is a technical check of document readability only. It does not evaluate the medical validity, accuracy, or completeness of your documents.
  - Always consult a qualified healthcare professional regarding any medical condition, test result, or treatment decision.

IN A MEDICAL EMERGENCY, DO NOT USE THIS PORTAL. Call your local emergency services or go to the nearest emergency facility immediately.


4. ACCOUNT REGISTRATION AND SECURITY

  - You must provide accurate, current, and complete information during registration.
  - You are responsible for maintaining the confidentiality of your account credentials.
  - You are responsible for all activities that occur under your account.
  - You must notify Bloodcare Medical Laboratory immediately of any unauthorized use of your account.
  - Email verification is required to activate your account. Changes to your registered email require verification of the new address.
  - Certain profile information (name, date of birth, gender) can only be changed by contacting clinic administration, to protect the integrity of your medical records.


5. ACCEPTABLE USE

You agree NOT to:
  - Use the portal for any unlawful purpose
  - Submit false, misleading, or fraudulent documents or information
  - Attempt to gain unauthorized access to any part of the system, other users' accounts, or clinic data
  - Interfere with or disrupt the portal or its servers
  - Reverse engineer, decompile, or attempt to extract the source code of the portal
  - Use automated systems to access the portal without permission
  - Impersonate any person or misrepresent your identity
  - Upload malicious code or content


6. DOCUMENT SUBMISSION

  - Documents you submit may be processed server-side by Google Generative AI for verbatim text extraction.
  - The extracted text may be assessed for quality by an automated service.
  - You are responsible for ensuring documents you submit are your own and are accurate.
  - Submission of a document does not guarantee acceptance. Clinic staff review all submissions.
  - Bloodcare Medical Laboratory reserves the right to reject any submission that is illegible, fraudulent, or inappropriate.


7. INTELLECTUAL PROPERTY

The KlinikAid portal, including its design, features, text, graphics, and logos, is the property of the KlinikAid development team and Bloodcare Medical Laboratory. You may not copy, modify, distribute, or create derivative works without express written permission.


8. AI ASSISTANT LIMITATIONS

The AI assistant answers questions using information provided by Bloodcare Medical Laboratory. It:
  - May not always be accurate or complete
  - Does not provide medical advice
  - Should not be used for urgent or emergency concerns
  - Is limited to general clinic-related information

Your use of the AI assistant is at your own discretion.


9. DATA PRIVACY

Your personal and medical information is handled in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173) as described in our separate Data Privacy Policy. By using this portal you acknowledge that you have reviewed the Data Privacy Policy.


10. SERVICE AVAILABILITY

  - We strive to keep the portal available but do not guarantee uninterrupted access.
  - The portal may be unavailable during maintenance, updates, or due to circumstances beyond our control.
  - Features may change, be added, or be removed over time.
  - Some features require an internet connection.


11. LIMITATION OF LIABILITY

To the fullest extent permitted by law, Bloodcare Medical Laboratory and the KlinikAid development team shall not be liable for any indirect, incidental, or consequential damages arising from:
  - Your use of or inability to use the portal
  - Any errors or inaccuracies in content, including AI responses or document quality assessments
  - Any decisions made based on information from the portal
  - Unauthorized access to your account resulting from your failure to safeguard your credentials

This limitation does not exclude liability that cannot be excluded under applicable Philippine law.

// PRODUCTION LEGAL REVIEW: liability limitations must be validated against Philippine consumer protection and medical practice law.


12. TERMINATION

We reserve the right to suspend or terminate your account if you violate these terms, engage in fraudulent activity, or misuse the portal. You may stop using the portal at any time. Certain data may be retained as required by medical records law even after account termination.


13. CHANGES TO THESE TERMS

We may update these Terms and Conditions from time to time. Continued use of the portal after changes constitutes acceptance of the updated terms. Material changes will be communicated through the portal.


14. GOVERNING LAW

These Terms and Conditions are governed by the laws of the Republic of the Philippines. Any disputes shall be subject to the exclusive jurisdiction of the courts of the Philippines.

// PRODUCTION LEGAL REVIEW: confirm venue and dispute resolution clauses with legal counsel.


15. CONTACT

For questions about these Terms and Conditions, contact Bloodcare Medical Laboratory directly through the clinic's official contact channels.


By checking the acceptance box during registration, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions.
`;

interface TermsAndConditionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReadComplete: () => void;
}

export default function TermsAndConditionsModal({
  open,
  onOpenChange,
  onReadComplete,
}: TermsAndConditionsModalProps) {
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const visibleTerms = useMemo(
    () =>
      TERMS_AND_CONDITIONS_TEXT.split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n")
        .trim(),
    []
  );

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (nextOpen) {
      setHasScrolledToBottom(false);
      window.requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (container && container.scrollHeight <= container.clientHeight) {
          setHasScrolledToBottom(true);
        }
      });
    }
  };

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const isAtBottom =
      container.scrollHeight - container.scrollTop <= container.clientHeight + 15;

    if (isAtBottom) {
      setHasScrolledToBottom(true);
    }
  };

  const handleUnderstand = () => {
    if (!hasScrolledToBottom) return;
    onReadComplete();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden" showCloseButton>
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <DialogTitle className="text-xl font-bold tracking-tight">
              Terms and Conditions
            </DialogTitle>
          </div>
          <DialogDescription>
            Please read to the bottom before accepting the KlinikAid Terms and Conditions.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="h-96 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap select-none"
          >
            {visibleTerms}
          </div>
          {!hasScrolledToBottom && (
            <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
              Please scroll to the bottom of the terms to enable acknowledgement.
            </p>
          )}
        </div>

        <DialogFooter className="px-6 py-4">
          <Button
            type="button"
            onClick={handleUnderstand}
            disabled={!hasScrolledToBottom}
            className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white"
          >
            I Understand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
