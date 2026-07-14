"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { Document } from "@/types";
import type { DetectedClinicTest } from "@/lib/documents/detectRequestedTests";
import { 
  FileText, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Sparkles, 
  Clock, 
  User, 
  ArrowRight,
  Database,
  Search
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

interface ReceptionKanbanProps {
  initialDocuments: Document[];
}

type ColumnId = "submitted" | "ai_verified" | "staff_review" | "approved" | "rejected";

interface Column {
  id: ColumnId;
  title: string;
  description: string;
  color: string;
  icon: React.ReactNode;
}

export default function ReceptionKanban({ initialDocuments }: ReceptionKanbanProps) {
  const supabase = createClient();
  const [documents, setDocuments] = useState<Document[]>(initialDocuments);
  const [searchQuery, setSearchQuery] = useState("");

  // Helper to categorize document into Kanban columns
  const getColumn = (doc: Document): ColumnId => {
    if (doc.status === "approved") return "approved";
    if (doc.status === "rejected") return "rejected";
    
    const metadata = doc.extracted_metadata as { ocr_confidence_score?: number } | null;
    const score = metadata?.ocr_confidence_score;
    
    if (score === undefined || score === null) {
      return "submitted";
    }
    if (score >= 85) {
      return "ai_verified";
    }
    return "staff_review";
  };

  // Realtime Supabase Subscription
  useEffect(() => {
    const channel = supabase
      .channel("reception-documents-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
        },
        async (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          
          if (eventType === "DELETE") {
            setDocuments((prev) => prev.filter((doc) => doc.id !== oldRecord.id));
            toast.info("A document was deleted.");
            return;
          }

          // For INSERT or UPDATE, we need to fetch the fully-joined record (patient + uploader)
          // because Realtime payloads only contain the raw table row.
          const { data: fullyJoinedDoc, error } = await supabase
            .from("documents")
            .select(`
              *,
              patient:patient_id (
                id,
                first_name,
                last_name,
                date_of_birth,
                gender,
                contact_number,
                email,
                address
              ),
              uploader:uploader_id (
                id,
                full_name,
                role
              )
            `)
            .eq("id", newRecord.id)
            .single();

          if (error) {
            console.error("Error fetching realtime document details:", error);
            return;
          }

          if (fullyJoinedDoc) {
            setDocuments((prev) => {
              const exists = prev.some((d) => d.id === fullyJoinedDoc.id);
              if (exists) {
                // Update
                return prev.map((d) => (d.id === fullyJoinedDoc.id ? fullyJoinedDoc : d));
              } else {
                // Insert at the beginning of the list
                return [fullyJoinedDoc, ...prev];
              }
            });

            if (eventType === "INSERT") {
              toast.success(`New document uploaded: ${fullyJoinedDoc.file_name}`);
            } else if (eventType === "UPDATE") {
              toast.info(`Document status updated to: ${fullyJoinedDoc.status}`);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Handle Search Filtering
  const filteredDocuments = documents.filter((doc) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const patientName = `${doc.patient?.first_name || ""} ${doc.patient?.last_name || ""}`.toLowerCase();
    const fileName = doc.file_name.toLowerCase();
    const docType = doc.file_type.toLowerCase();
    const uploaderName = doc.uploader?.full_name?.toLowerCase() || "";
    return (
      patientName.includes(q) ||
      fileName.includes(q) ||
      docType.includes(q) ||
      uploaderName.includes(q)
    );
  });

  // Group documents by column
  const columnsData: Record<ColumnId, Document[]> = {
    submitted: [],
    ai_verified: [],
    staff_review: [],
    approved: [],
    rejected: [],
  };

  filteredDocuments.forEach((doc) => {
    const colId = getColumn(doc);
    columnsData[colId].push(doc);
  });

  const columns: Column[] = [
    {
      id: "submitted",
      title: "Submitted",
      description: "Direct patient web uploads waiting for processing",
      color: "bg-slate-100/80 dark:bg-slate-900/40 border-t-slate-400 dark:border-t-slate-600",
      icon: <Database className="h-4 w-4 text-slate-500" />,
    },
    {
      id: "ai_verified",
      title: "AI Verified",
      description: "Processed by AI with high confidence score (≥85%)",
      color: "bg-emerald-50/50 dark:bg-emerald-950/10 border-t-emerald-500 dark:border-t-emerald-600",
      icon: <Sparkles className="h-4 w-4 text-emerald-500" />,
    },
    {
      id: "staff_review",
      title: "Staff Review",
      description: "Needs receptionist verification due to lower confidence (<85%)",
      color: "bg-amber-50/50 dark:bg-amber-950/10 border-t-amber-500 dark:border-t-amber-600",
      icon: <AlertCircle className="h-4 w-4 text-amber-500" />,
    },
    {
      id: "approved",
      title: "Approved",
      description: "Validated and patient successfully routed to triage queue",
      color: "bg-teal-50/50 dark:bg-teal-950/10 border-t-teal-600 dark:border-t-teal-700",
      icon: <CheckCircle2 className="h-4 w-4 text-teal-600" />,
    },
    {
      id: "rejected",
      title: "Rejected",
      description: "Returned to patient due to legibility or mismatch issues",
      color: "bg-rose-50/50 dark:bg-rose-950/10 border-t-rose-500 dark:border-t-rose-600",
      icon: <XCircle className="h-4 w-4 text-rose-500" />,
    },
  ];

  // Helper to render OCR badge
  const renderOcrBadge = (doc: Document) => {
    if (doc.file_type === "template") {
      return (
        <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/10 font-bold">
          Structured Form
        </Badge>
      );
    }

    const metadata = doc.extracted_metadata as { ocr_confidence_score?: number } | null;
    const score = metadata?.ocr_confidence_score;

    if (score === undefined || score === null) {
      return (
        <Badge variant="outline" className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-medium">
          Web Upload
        </Badge>
      );
    }

    if (score >= 85) {
      return (
        <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium">
          AI {score}%
        </Badge>
      );
    }

    if (score >= 70) {
      return (
        <Badge className="bg-amber-500 hover:bg-amber-600 text-white font-medium">
          AI {score}%
        </Badge>
      );
    }

    return (
      <Badge className="bg-rose-500 hover:bg-rose-600 text-white font-medium">
        AI {score}%
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
          <Input
            placeholder="Search patient name, file name, type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-slate-50/50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 focus:bg-white dark:focus:bg-slate-950 transition-colors"
          />
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium sm:ml-auto">
          Showing {filteredDocuments.length} of {documents.length} submissions
        </div>
      </div>

      {/* Kanban Board Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 h-[calc(100vh-240px)] min-h-[600px] overflow-x-auto pb-4">
        {columns.map((col) => {
          const list = columnsData[col.id];
          return (
            <div
              key={col.id}
              className={`flex flex-col rounded-xl border border-slate-200/80 dark:border-slate-800/80 p-3.5 space-y-3 min-w-[260px] h-full ${col.color} border-t-2`}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-200/50 dark:border-slate-800/50">
                <div className="flex items-center gap-2">
                  {col.icon}
                  <span className="font-bold text-sm text-slate-800 dark:text-slate-200 tracking-tight">
                    {col.title}
                  </span>
                </div>
                <Badge variant="secondary" className="px-2 py-0.5 rounded-full font-semibold text-xs bg-slate-200/60 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {list.length}
                </Badge>
              </div>

              {/* Column Description */}
              <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-normal pb-1 font-medium">
                {col.description}
              </div>

              {/* Cards Container */}
              <div className="flex-1 space-y-3 overflow-y-auto pr-1 select-none">
                {list.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-24 border border-dashed border-slate-200 dark:border-slate-800/50 rounded-lg text-slate-400 dark:text-slate-600 text-xs">
                    No documents
                  </div>
                ) : (
                  list.map((doc) => {
                    const isStaffReview = col.id === "staff_review";
                    const metadata = doc.extracted_metadata as { selected_tests?: DetectedClinicTest[] } | null;
                    const selectedTests = Array.isArray(metadata?.selected_tests) ? metadata.selected_tests : [];

                    return (
                      <Link
                        key={doc.id}
                        href={`/reception/queue/${doc.id}`}
                        className="block group focus:outline-none"
                      >
                        <Card
                          className={`border-slate-200/80 dark:border-slate-800/80 shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-200 cursor-pointer ${
                            isStaffReview ? "border-l-4 border-l-amber-500" : ""
                          }`}
                        >
                          <CardHeader className="p-3 pb-2 space-y-1.5">
                            <div className="flex justify-between items-start gap-1">
                              <CardTitle className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-primary dark:group-hover:text-accentBlue-400 transition-colors line-clamp-1">
                                {doc.patient
                                  ? `${doc.patient.first_name} ${doc.patient.last_name}`
                                  : "Unknown Patient"}
                              </CardTitle>
                              {renderOcrBadge(doc)}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                              <Clock className="h-3 w-3" />
                              <span>{formatDistanceToNow(new Date(doc.created_at))} ago</span>
                            </div>
                          </CardHeader>
                          <CardContent className="p-3 pt-0 space-y-2">
                            <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1">
                              <FileText className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                              <span className="truncate max-w-[150px]">{doc.file_name}</span>
                            </div>

                            {selectedTests.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {selectedTests.map((test) => (
                                  <Badge
                                    key={test.id}
                                    variant="outline"
                                    className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-300 text-[10px] px-1.5 py-0"
                                  >
                                    {test.label}
                                  </Badge>
                                ))}
                              </div>
                            )}
                             
                            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-900 pt-2 text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                              <span className="flex items-center gap-1">
                                <User className="h-2.5 w-2.5" />
                                <span className="truncate max-w-[100px]">
                                  {doc.uploader?.full_name || "System"}
                                </span>
                              </span>
                              <span className="text-xs text-primary group-hover:translate-x-1 transition-transform dark:text-accentBlue-400">
                                <ArrowRight className="h-3.5 w-3.5" />
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
