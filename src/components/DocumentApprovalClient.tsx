"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns-tz";
import { Document } from "@/types";
import {
  FileText,
  User,
  Phone,
  Mail,
  MapPin,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronLeft,
  ArrowRight,
  ExternalLink,
  Loader2,
  ShieldCheck,
  ClipboardList
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { getReceptionDocumentSignedUrlAction } from "@/app/(dashboard)/reception/queue/[documentId]/actions";
import { DEPARTMENTS } from "@/lib/constants";
import { Department } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import TriageModal from "./TriageModal";

interface DocumentApprovalClientProps {
  document: Document;
}

export default function DocumentApprovalClient({ document: initialDoc }: DocumentApprovalClientProps) {
  const router = useRouter();
  const [doc, setDoc] = useState<Document>(initialDoc);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isTriageOpen, setIsTriageOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [isPending, startTransition] = useTransition();

  const metadata = doc.extracted_metadata as unknown as {
    ocr_confidence_score?: number;
    ocr_flags?: string[];
    field_confidences?: Record<string, number>;
    reviewed_at?: string;
    reviewed_by_name?: string;
    review_notes?: string;
    destination_department?: Department | null;
    destination_department_label?: string | null;
  } | null;
  const ocrConfidence = metadata?.ocr_confidence_score as number | undefined;
  const ocrFlags = (metadata?.ocr_flags || []) as string[];
  const fieldConfidences = metadata?.field_confidences as Record<string, number> | undefined;
  const destinationDepartmentLabel = metadata?.destination_department_label
    || (metadata?.destination_department ? DEPARTMENTS[metadata.destination_department]?.label : null);

  // Format dates in Manila timezone
  const formatZonedDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return format(date, "yyyy-MM-dd hh:mm a");
    } catch {
      return dateString;
    }
  };

  // OCR Flag Highlighting
  const highlightOcrText = (text: string | null, flags: string[]) => {
    if (!text) {
      return (
        <div className="text-slate-400 dark:text-slate-500 italic py-8 text-center">
          No OCR text extraction available for this document.
        </div>
      );
    }

    if (!flags || flags.length === 0) return text;

    const escapedFlags = flags
      .map((f) => f.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"))
      .filter((f) => f.trim().length > 0);

    if (escapedFlags.length === 0) return text;

    const regex = new RegExp(`\\b(${escapedFlags.join("|")})\\b`, "gi");
    const parts = text.split(regex);

    return parts.map((part, index) => {
      const isMatch = flags.some((f) => f.toLowerCase() === part.toLowerCase());
      if (isMatch) {
        return (
          <span
            key={index}
            className="bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-1 py-0.5 rounded font-bold border border-red-200 dark:border-red-900/60 inline-flex items-center gap-0.5 animate-pulse"
          >
            ⚠️ {part}
          </span>
        );
      }
      return part;
    });
  };

  // Rejection Submission Handler
  const handleReject = () => {
    if (rejectionReason.trim().length < 20) {
      toast.error("Rejection reason must be at least 20 characters long.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/reception/documents/${doc.id}/reject`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rejection_reason: rejectionReason,
          }),
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || "Failed to reject document");
        }

        setDoc(result.data);
        setIsRejectOpen(false);
        toast.success("Document successfully rejected and returned to patient");
        router.refresh();
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        toast.error(errMsg || "An unexpected error occurred during rejection");
      }
    });
  };

  const handleViewOriginal = async () => {
    setIsOpeningFile(true);
    const newTab = window.open("", "_blank");
    try {
      const result = await getReceptionDocumentSignedUrlAction(doc.id);
      if (result.success && result.signedUrl && newTab) {
        newTab.location.href = result.signedUrl;
        return;
      }

      if (newTab) newTab.close();
      toast.error(result.error || "Failed to generate file access link.");
    } catch (error: unknown) {
      if (newTab) newTab.close();
      console.error("[DocumentApprovalClient] Error opening document:", error);
      toast.error("Failed to generate file access link.");
    } finally {
      setIsOpeningFile(false);
    }
  };

  // Style helper for confidence colors
  const getConfidenceColorClass = (score: number) => {
    if (score >= 85) return "bg-emerald-500";
    if (score >= 70) return "bg-amber-500";
    return "bg-rose-500";
  };

  const getConfidenceTextColorClass = (score: number) => {
    if (score >= 85) return "text-emerald-600 dark:text-emerald-400";
    if (score >= 70) return "text-amber-600 dark:text-amber-400";
    return "text-rose-600 dark:text-rose-400";
  };

  const getConfidenceLabel = (score: number) => {
    if (score >= 85) return "High Confidence (Approved)";
    if (score >= 70) return "Medium Confidence (Staff Review)";
    return "Low Confidence (Verify Carefully)";
  };

  // Patient display name helper
  const patientName = doc.patient
    ? `${doc.patient.first_name} ${doc.patient.last_name}`
    : "Unknown Patient";

  return (
    <div className="space-y-6">
      {/* Back to Queue header button */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => router.push("/reception/queue")}
          className="gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Queue
        </Button>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Status:</span>
          {doc.status === "pending" && (
            <Badge className="bg-amber-500 text-white hover:bg-amber-600">Pending Review</Badge>
          )}
          {doc.status === "approved" && (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">Approved</Badge>
          )}
          {doc.status === "rejected" && (
            <Badge className="bg-rose-600 text-white hover:bg-rose-700">Rejected</Badge>
          )}
        </div>
      </div>

      {/* Main 3-panel responsive layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* PANEL 1: Left - Patient & Document Info (Col span 4) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Patient Card */}
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <CardTitle className="text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <User className="h-4 w-4 text-accentBlue-500" />
                Patient Details
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3.5 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-900">
                <span className="font-semibold text-slate-500">Name</span>
                <span className="font-bold text-slate-900 dark:text-white">{patientName}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-900">
                <span className="font-semibold text-slate-500">Date of Birth</span>
                <span className="font-mono text-slate-800 dark:text-slate-300">
                  {doc.patient?.date_of_birth || "—"}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-900">
                <span className="font-semibold text-slate-500">Gender</span>
                <span className="capitalize text-slate-800 dark:text-slate-300">
                  {doc.patient?.gender || "—"}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-900">
                <span className="font-semibold text-slate-500">Contact Number</span>
                <span className="font-mono text-slate-800 dark:text-slate-300 flex items-center gap-1">
                  <Phone className="h-3 w-3 text-slate-400" />
                  {doc.patient?.contact_number || "—"}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-900">
                <span className="font-semibold text-slate-500">Email</span>
                <span className="font-mono text-slate-800 dark:text-slate-300 flex items-center gap-1">
                  <Mail className="h-3 w-3 text-slate-400" />
                  {doc.patient?.email || "—"}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 pt-1">
                <span className="font-semibold text-slate-500">Address</span>
                <span className="text-slate-800 dark:text-slate-300 flex items-start gap-1 leading-normal">
                  <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                  {doc.patient?.address || "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Document Info Card */}
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <CardTitle className="text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <FileText className="h-4 w-4 text-accentBlue-500" />
                Document Metadata
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3.5 text-xs">
              <div className="flex flex-col gap-1 py-1 border-b border-slate-50 dark:border-slate-900">
                <span className="font-semibold text-slate-500">File Name</span>
                <span className="font-medium text-slate-900 dark:text-white truncate" title={doc.file_name}>
                  {doc.file_name}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-900">
                <span className="font-semibold text-slate-500">File Type</span>
                <span className="uppercase text-slate-800 dark:text-slate-300 font-mono">
                  {doc.file_type}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-900">
                <span className="font-semibold text-slate-500">Uploaded At</span>
                <span className="text-slate-800 dark:text-slate-300 font-mono">
                  {formatZonedDate(doc.created_at)}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-900">
                <span className="font-semibold text-slate-500">Uploaded By</span>
                <span className="text-slate-800 dark:text-slate-300 font-medium">
                  {doc.uploader?.full_name || "System"} ({doc.uploader?.role || "Patient"})
                </span>
              </div>

              <div className="pt-2">
                <Button
                  variant="outline"
                  disabled={isOpeningFile}
                  onClick={handleViewOriginal}
                  className="w-full text-xs font-semibold border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900 flex items-center justify-center gap-1.5"
                >
                  {isOpeningFile ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  View Original Document
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* PANEL 2: Center - OCR Output (Col span 5) */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm h-[600px] flex flex-col">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex justify-between items-center">
                <CardTitle className="text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-accentBlue-500" />
                  OCR Text Output
                </CardTitle>
                <Badge variant="outline" className="text-[10px] uppercase font-mono px-2">
                  Monospace Raw
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Parsed contents of the uploaded referral / document
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 flex-1 overflow-hidden flex flex-col">
              {ocrFlags.length > 0 && (
                <div className="mb-3.5 p-2.5 bg-rose-50 border border-rose-200/50 text-rose-800 text-[11px] rounded-lg dark:bg-rose-950/20 dark:border-rose-900/40 dark:text-rose-350 flex items-start gap-1.5 leading-normal shrink-0">
                  <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Verification Suggested:</span> The following parameters were flagged in the document:{" "}
                    <span className="font-mono bg-rose-100/50 dark:bg-rose-900/40 px-1 py-0.5 rounded font-bold">
                      {ocrFlags.join(", ")}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800 rounded-lg p-3.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text text-slate-800 dark:text-slate-300">
                {highlightOcrText(doc.ocr_text, ocrFlags)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* PANEL 3: Right - ML Kit Confidence (Col span 3) */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <CardTitle className="text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-accentBlue-500" />
                AI Validation Report
              </CardTitle>
              <CardDescription className="text-xs">
                OCR and data-matching validation metrics
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-5">
              
              {/* Overall Confidence */}
              <div className="space-y-2">
                <div className="flex justify-between items-end">
                  <span className="text-xs font-semibold text-slate-500">Overall AI Confidence</span>
                  <span className={`text-sm font-extrabold ${ocrConfidence !== undefined ? getConfidenceTextColorClass(ocrConfidence) : "text-slate-400"}`}>
                    {ocrConfidence !== undefined ? `${ocrConfidence}%` : "No OCR Score"}
                  </span>
                </div>
                {ocrConfidence !== undefined ? (
                  <div className="space-y-1.5">
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${getConfidenceColorClass(ocrConfidence)}`}
                        style={{ width: `${ocrConfidence}%` }}
                      />
                    </div>
                    <div className="text-[10px] font-semibold text-slate-400">
                      {getConfidenceLabel(ocrConfidence)}
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-slate-400 italic">
                    Confidence score not available for this upload.
                  </div>
                )}
              </div>

              {/* Field Confidences */}
              {fieldConfidences && Object.keys(fieldConfidences).length > 0 && (
                <div className="space-y-3.5 pt-2 border-t border-slate-100 dark:border-slate-900">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Field Matching Scores</span>
                  <div className="space-y-3">
                    {Object.entries(fieldConfidences).map(([field, score]) => {
                      // Map field key to friendly text
                      const friendlyLabels: Record<string, string> = {
                        patient_name: "Patient Name",
                        date_of_birth: "Date of Birth",
                        test_type: "Test Type",
                        clinic_header: "Clinic Header",
                        doctor_signature: "Doctor Signature",
                      };
                      const label = friendlyLabels[field] || field.replace(/_/g, " ");

                      return (
                        <div key={field} className="space-y-1">
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="capitalize font-medium text-slate-600 dark:text-slate-400">{label}</span>
                            <span className={`font-bold ${getConfidenceTextColorClass(score)}`}>{score}%</span>
                          </div>
                          <div className="w-full bg-slate-100 dark:bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${getConfidenceColorClass(score)}`}
                              style={{ width: `${score}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom Sticky Action Bar */}
      <div className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 p-4 rounded-xl shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4 mt-8">
        
        {/* Left Side: Detail or Resolution display */}
        <div className="text-xs flex-1">
          {doc.status !== "pending" ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-700 dark:text-slate-300">Review Resolution:</span>
                {doc.status === "approved" ? (
                  <Badge className="bg-emerald-600 text-white font-medium flex items-center gap-0.5">
                    <CheckCircle className="h-3 w-3" /> Approved
                  </Badge>
                ) : (
                  <Badge className="bg-rose-600 text-white font-medium flex items-center gap-0.5">
                    <XCircle className="h-3 w-3" /> Rejected
                  </Badge>
                )}
                {doc.status === "approved" && destinationDepartmentLabel && (
                  <Badge variant="outline" className="font-medium text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800">
                    Destination: {destinationDepartmentLabel}
                  </Badge>
                )}
              </div>
              <p className="text-slate-500">
                Processed on {metadata?.reviewed_at ? formatZonedDate(metadata.reviewed_at) : formatZonedDate(doc.updated_at)} by{" "}
                <span className="font-semibold text-slate-850 dark:text-slate-300">{metadata?.reviewed_by_name || "Staff"}</span>.
              </p>
              {doc.status === "rejected" && doc.rejection_reason && (
                <div className="mt-1 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/30 p-2 rounded text-rose-800 dark:text-rose-300 font-medium">
                  Reason: {doc.rejection_reason}
                </div>
              )}
              {doc.status === "approved" && metadata?.review_notes && (
                <div className="mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-200/40 p-2 rounded text-slate-600 dark:text-slate-400 font-medium">
                  Staff Notes: {metadata.review_notes}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1 max-w-xl">
              <span className="font-bold text-slate-700 dark:text-slate-300">Receptionist Actions</span>
              <p className="text-slate-400 leading-normal">
                Carefully review the matching metrics. Click Approve to assign the patient to a clinic department queue, or Reject to request a clearer document upload.
              </p>
            </div>
          )}
        </div>

        {/* Right Side: Action Buttons */}
        {doc.status === "pending" && (
          <div className="flex items-center gap-3 self-end md:self-auto">
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => setIsRejectOpen(true)}
              className="border-slate-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-800 dark:hover:bg-rose-950/30 font-semibold text-xs h-9 px-4"
            >
              Reject Document
            </Button>
            <Button
              onClick={() => setIsTriageOpen(true)}
              disabled={isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 px-4 flex items-center gap-1.5 shadow-md shadow-emerald-500/10"
            >
              Approve & Route Patient
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* REJECT CONFIRMATION DIALOG */}
      <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
        <DialogContent className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-white flex items-center gap-2">
              <XCircle className="h-5 w-5 text-rose-500" />
              Reject Document Submission?
            </DialogTitle>
            <DialogDescription className="text-xs pt-1">
              Provide a clear rejection feedback message to the patient explaining why their submission was declined (e.g., illegible text, name mismatch, wrong test requisition).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2">
            <div className="space-y-1.5">
              <label htmlFor="rejection_reason" className="text-xs font-semibold text-slate-500">
                Rejection Reason (Minimum 20 characters)
              </label>
              <Textarea
                id="rejection_reason"
                placeholder="The patient name on the referral does not match your profile account details. Please upload a correct medical referral."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={4}
                className="text-xs border-slate-200 dark:border-slate-800"
              />
              <div className="flex justify-between items-center text-[10px] text-slate-400">
                <span>{rejectionReason.length} characters</span>
                {rejectionReason.length < 20 && (
                  <span className="text-rose-500 font-semibold">Needs {20 - rejectionReason.length} more characters</span>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-slate-100 dark:border-slate-900">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setIsRejectOpen(false)}
              className="border-slate-200 text-xs dark:border-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={rejectionReason.trim().length < 20 || isPending}
              onClick={handleReject}
              className="text-xs font-semibold shadow-sm"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Rejecting...
                </>
              ) : (
                "Confirm Rejection"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TRIAGE MODAL FOR ROUTING */}
      {isTriageOpen && (
        <TriageModal
          isOpen={isTriageOpen}
          onClose={() => setIsTriageOpen(false)}
          patientId={doc.patient_id || ""}
          patientName={patientName}
          documentId={doc.id}
        />
      )}
    </div>
  );
}
