"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSignedUrlAction, deletePendingDocumentAction } from "./actions";
import { toast } from "sonner";
import { 
  FileText, 
  Trash2, 
  Eye, 
  Clock, 
  AlertTriangle,
  Loader2,
  RefreshCw,
  Activity,
  Heart,
  Thermometer,
  Scale
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  AlertDialog, 
  AlertDialogContent, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogCancel, 
  AlertDialogAction 
} from "@/components/ui/alert-dialog";
import { formatPhTimeFull } from "@/lib/utils";
import { Document, PatientQueue } from "@/types";

interface SubmissionsClientProps {
  initialDocuments: Document[];
  initialQueue: PatientQueue[];
  patientId: string;
}

export default function SubmissionsClient({
  initialDocuments,
  initialQueue,
  patientId
}: SubmissionsClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const [documents, setDocuments] = useState<Document[]>(initialDocuments);
  const [queue, setQueue] = useState<PatientQueue[]>(initialQueue);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewingFileId, setViewingFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string>("");

  // Sync state if props change (e.g. from server action revalidation)
  useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);

  useEffect(() => {
    setQueue(initialQueue);
  }, [initialQueue]);

  // Realtime Supabase Subscription for queue changes
  useEffect(() => {
    const channel = supabase
      .channel(`patient_queue_patient:${patientId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patient_queue",
          filter: `patient_id=eq.${patientId}`,
        },
        async (payload) => {
          const { eventType, new: newRecord } = payload;
          console.log("[Realtime Queue Event]:", eventType, newRecord);

          // Trigger a silent refresh of server-side state
          router.refresh();

          if (eventType === "INSERT") {
            toast.success("You have been added to a clinic queue!");
          } else if (eventType === "UPDATE") {
            const updated = newRecord as PatientQueue;
            toast.info(`Queue status updated: ${updated.status.replace("_", " ")}`);
          } else if (eventType === "DELETE") {
            toast.warning("You have been removed from the queue.");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [patientId, supabase, router]);

  // Realtime Supabase Subscription for document status changes
  useEffect(() => {
    const channel = supabase
      .channel(`documents_patient:${patientId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
          filter: `patient_id=eq.${patientId}`,
        },
        async (payload) => {
          console.log("[Realtime Document Event]:", payload.eventType, payload.new);
          router.refresh();
          
          if (payload.eventType === "UPDATE") {
            const updated = payload.new as Document;
            if (updated.status === "approved") {
              toast.success(`Document approved: ${updated.file_name}`);
            } else if (updated.status === "rejected") {
              toast.error(`Document rejected: ${updated.file_name}`);
            }
          } else if (payload.eventType === "DELETE") {
            const deleted = payload.old as Partial<Document>;
            if (deleted.id) {
              setDocuments((current) => current.filter((doc) => doc.id !== deleted.id));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [patientId, supabase, router]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => {
      setIsRefreshing(false);
      toast.success("Page data refreshed.");
    }, 800);
  };

  const handleView = async (docId: string) => {
    setViewingFileId(docId);
    try {
      const res = await getSignedUrlAction(docId);
      if (res.success && res.signedUrl) {
        window.open(res.signedUrl, "_blank");
      } else {
        toast.error(res.error || "Failed to view document.");
      }
    } catch (err) {
      console.error(err);
      toast.error("An unexpected error occurred.");
    } finally {
      setViewingFileId(null);
    }
  };

  const handleDelete = async (docId: string, fileName: string) => {
    setConfirmDeleteId(docId);
    setConfirmDeleteName(fileName);
  };

  const executeDelete = async () => {
    if (!confirmDeleteId) return;
    const docId = confirmDeleteId;
    setConfirmDeleteId(null);
    setDeletingFileId(docId);
    try {
      const res = await deletePendingDocumentAction(docId);
      if (res.success) {
        setDocuments((current) => current.filter((doc) => doc.id !== docId));
        toast.success("Submission successfully cancelled and file deleted.");
        router.refresh();
      } else {
        toast.error(res.error || "Failed to cancel submission.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to cancel submission.");
    } finally {
      setDeletingFileId(null);
    }
  };

  // Safe parse triage notes JSON string
  const parseTriageNotes = (notesStr: string | null) => {
    if (!notesStr) return null;
    try {
      return JSON.parse(notesStr);
    } catch {
      return null;
    }
  };

  const getQueueBadge = (status: string) => {
    switch (status) {
      case "waiting":
        return <Badge className="bg-accentBlue-500 hover:bg-accentBlue-600 text-white font-medium">Waiting</Badge>;
      case "in_progress":
        return <Badge className="bg-purple-500 hover:bg-purple-600 text-white font-medium animate-pulse">In Progress</Badge>;
      case "completed":
        return <Badge className="bg-green-500 hover:bg-green-600 text-white font-medium">Completed</Badge>;
      default:
        return <Badge variant="secondary" className="font-medium">Cancelled</Badge>;
    }
  };

  const getDocStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-emerald-500 text-white font-medium">Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="font-medium">Rejected</Badge>;
      default:
        return <Badge className="bg-yellow-500 text-white font-medium">Pending Review</Badge>;
    }
  };

  const activeQueueList = queue.filter(q => q.status === "waiting" || q.status === "in_progress");

  return (
    <div className="space-y-6">
      {/* Top Banner Control */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Track Submissions</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Monitor real-time status of clinic queue items and uploaded referrals
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="border-slate-200 dark:border-slate-800"
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2 hidden sm:inline">Refresh Data</span>
        </Button>
      </div>

      {/* Grid containing Queue list and Referral list */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Side: Live Queue Progress (1 Column) */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-md">
            <CardHeader className="flex flex-row items-center gap-3.5 bg-slate-50/55 dark:bg-slate-900/30 pb-4">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accentBlue-100 text-accentBlue-600 dark:bg-accentBlue-950/40 dark:text-accentBlue-400">
                <Activity className="h-4.5 w-4.5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">Active Queue Status</CardTitle>
                <CardDescription className="text-xs">Live updates from reception triage</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              {activeQueueList.length === 0 ? (
                <div className="text-center py-8 text-slate-400 dark:text-slate-500 flex flex-col items-center justify-center space-y-2">
                  <Clock className="h-10 w-10 text-slate-350 stroke-1" />
                  <p className="text-sm font-semibold">Not currently in clinic queue</p>
                  <p className="text-xs max-w-[200px] leading-relaxed">
                    Once receptionist approves your referral, you will enter the department queue.
                  </p>
                </div>
              ) : (
                activeQueueList.map((item) => {
                  const triage = parseTriageNotes(item.triage_notes);
                  return (
                    <div key={item.id} className="space-y-4 p-4 border border-accentBlue-100/50 dark:border-accentBlue-950/20 bg-accentBlue-50/5 dark:bg-accentBlue-950/5 rounded-xl">
                      {/* Ticket Number */}
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Queue Number</span>
                          <span className="text-3xl font-black font-mono text-accentBlue-600 dark:text-accentBlue-400">
                            {triage?.queue_number || `--`}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          {getQueueBadge(item.status)}
                        </div>
                      </div>

                      {/* Department & Estimated Wait */}
                      <div className="grid grid-cols-2 gap-4 py-2.5 border-y border-slate-100 dark:border-slate-900 text-xs">
                        <div>
                          <span className="text-slate-400 block mb-0.5">Department:</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200 capitalize">
                            {item.department === "imaging" ? "Imaging (X-Ray)" : item.department}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block mb-0.5">Est. Wait Time:</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-accentBlue-500" />
                            {item.estimated_wait_minutes !== null 
                              ? `${item.estimated_wait_minutes} mins` 
                              : "Not available"}
                          </span>
                        </div>
                      </div>

                      {/* Vitals (If triage notes exist and contain vitals) */}
                      {triage?.vitals && (
                        <div className="space-y-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Triage Vitals Check</span>
                          <div className="grid grid-cols-3 gap-2.5 text-center">
                            {triage.vitals.blood_pressure && (
                              <div className="bg-slate-50 dark:bg-slate-900/60 p-2 rounded-lg border border-slate-150 dark:border-slate-850">
                                <Heart className="h-3.5 w-3.5 mx-auto text-red-500 mb-0.5" />
                                <p className="text-[10px] text-slate-400">Blood Pressure</p>
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono mt-0.5">{triage.vitals.blood_pressure}</p>
                              </div>
                            )}
                            {triage.vitals.temperature_c && (
                              <div className="bg-slate-50 dark:bg-slate-900/60 p-2 rounded-lg border border-slate-150 dark:border-slate-850">
                                <Thermometer className="h-3.5 w-3.5 mx-auto text-amber-500 mb-0.5" />
                                <p className="text-[10px] text-slate-400">Temp</p>
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono mt-0.5">{triage.vitals.temperature_c}°C</p>
                              </div>
                            )}
                            {triage.vitals.weight_kg && (
                              <div className="bg-slate-50 dark:bg-slate-900/60 p-2 rounded-lg border border-slate-150 dark:border-slate-850">
                                <Scale className="h-3.5 w-3.5 mx-auto text-emerald-500 mb-0.5" />
                                <p className="text-[10px] text-slate-400">Weight</p>
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono mt-0.5">{triage.vitals.weight_kg}kg</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {triage?.notes && (
                        <div className="p-2.5 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-150 dark:border-slate-850 text-xs">
                          <span className="text-slate-400 block font-semibold mb-0.5">Triage Staff Note:</span>
                          <p className="text-slate-700 dark:text-slate-350 italic">{triage.notes}</p>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Submitted Referral Records (2 Columns) */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-md">
            <CardHeader className="flex flex-row items-center gap-3.5 bg-slate-50/55 dark:bg-slate-900/30 pb-4">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                <FileText className="h-4.5 w-4.5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">Uploaded Document History</CardTitle>
                <CardDescription className="text-xs">Immutable referral uploads status history</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {documents.length === 0 ? (
                <div className="text-center py-12 text-slate-400 dark:text-slate-500 flex flex-col items-center justify-center space-y-2">
                  <FileText className="h-12 w-12 text-slate-350 stroke-1" />
                  <p className="text-sm font-semibold">No uploaded documents found</p>
                  <p className="text-xs max-w-sm leading-relaxed">
                    Submit digital slips to request clinical department routing.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-900">
                  {documents.map((doc) => (
                    <div key={doc.id} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      {/* Document Meta Info */}
                      <div className="flex items-start space-x-3.5 min-w-0">
                        <div className="p-2 bg-slate-100 dark:bg-slate-900 text-slate-500 rounded-lg shrink-0">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate pr-4" title={doc.file_name}>
                            {doc.file_name}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                            <span>Uploaded: {formatPhTimeFull(doc.created_at)}</span>
                            <span>•</span>
                            <span className="capitalize">{doc.file_type.split("/")[1] || "Unknown"}</span>
                          </div>

                          {/* Rejection notice */}
                          {doc.status === "rejected" && doc.rejection_reason && (
                            <div className="mt-2 p-2.5 bg-red-50/70 dark:bg-red-950/20 border border-red-100/50 dark:border-red-900/40 rounded-lg text-xs flex items-start gap-2 text-red-800 dark:text-red-400">
                              <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-bold">Rejection Reason:</span>{" "}
                                <span className="italic">{doc.rejection_reason}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Status Badges & Action Buttons */}
                      <div className="flex sm:flex-col items-end gap-3.5 shrink-0 self-end sm:self-center">
                        <div className="flex items-center gap-2">
                          {getDocStatusBadge(doc.status)}
                        </div>

                        <div className="flex items-center gap-2.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleView(doc.id)}
                            disabled={viewingFileId !== null}
                            className="border-slate-200 dark:border-slate-850 h-8 text-xs font-semibold px-3 flex items-center gap-1.5"
                          >
                            {viewingFileId === doc.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Eye className="h-3.5 w-3.5 text-slate-400" />
                            )}
                            View File
                          </Button>

                          {doc.status === "pending" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(doc.id, doc.file_name)}
                              disabled={deletingFileId !== null}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 h-8 text-xs font-semibold px-2.5 flex items-center gap-1"
                            >
                              {deletingFileId === doc.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                              Cancel
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {/* Cancellation Confirmation Dialog */}
      <AlertDialog open={confirmDeleteId !== null} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Submission?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel the submission of &ldquo;{confirmDeleteName}&rdquo;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={executeDelete}
            >
              Cancel Submission
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
