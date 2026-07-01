import React from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/helpers";
import { getPhtStartOfToday } from "@/lib/utils";
import { 
  ClipboardList, 
  UserCheck, 
  FileCheck, 
  ArrowRightLeft,
  ArrowRight,
  Clock,
  History
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import NewPatientModal from "./NewPatientModal";

export const dynamic = "force-dynamic";

// Format Philippine Time (UTC+8) from UTC ISO String
function formatPhTime(utcString: string) {
  const date = new Date(utcString);
  const phDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = phDate.getUTCFullYear();
  const month = pad(phDate.getUTCMonth() + 1);
  const day = pad(phDate.getUTCDate());
  const hours = pad(phDate.getUTCHours());
  const minutes = pad(phDate.getUTCMinutes());
  
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export default async function ReceptionDashboardPage() {
  // 1. Authenticate user and enforce roles (Rule 1 & Rule 2)
  await requireRole(["admin", "receptionist"]);
  const supabase = createClient();

  // 2. Calculate start of today in UTC+8 terms, converted back to UTC ISO for database query
  const startOfToday = getPhtStartOfToday();


  // 3. Fetch metrics in parallel
  const [
    activeQueueResult,
    pendingDocsResult,
    todayRoutedResult,
    recentQueueResult
  ] = await Promise.all([
    // Active Queue (waiting or in progress)
    supabase
      .from("patient_queue")
      .select("id", { count: "exact", head: true })
      .in("status", ["waiting", "in_progress"]),

    // Pending Referrals
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),

    // Routed today
    supabase
      .from("patient_queue")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfToday),

    // Recent queue entries for list
    supabase
      .from("patient_queue")
      .select(`
        id,
        status,
        department,
        priority_level,
        triage_notes,
        created_at,
        patient:patient_id (
          first_name,
          last_name
        )
      `)
      .order("created_at", { ascending: false })
      .limit(5)
  ]);

  const activeQueueCount = activeQueueResult.count || 0;
  const pendingDocsCount = pendingDocsResult.count || 0;
  const todayRoutedCount = todayRoutedResult.count || 0;
  const recentQueue = (recentQueueResult.data || []) as unknown as {
    id: string;
    status: string;
    department: string;
    priority_level: string;
    triage_notes: string | null;
    created_at: string;
    patient: { first_name: string; last_name: string } | null;
  }[];

  // Parse queue number helper
  const getQueueNumber = (triageNotesStr: string | null) => {
    if (!triageNotesStr) return "—";
    try {
      const parsed = JSON.parse(triageNotesStr);
      return parsed.queue_number || "—";
    } catch {
      return "—";
    }
  };

  const getPriorityBadgeClass = (priority: string) => {
    switch (priority) {
      case "emergency":
        return "bg-rose-500 text-white dark:bg-rose-600";
      case "urgent":
        return "bg-amber-500 text-white dark:bg-amber-600";
      default:
        return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200";
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "waiting":
        return "bg-accentBlue-100 text-accentBlue-800 dark:bg-accentBlue-900/30 dark:text-accentBlue-400";
      case "in_progress":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400";
      case "completed":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
      default:
        return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Reception Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Front desk waitlists, document validations, and active triage routing
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <NewPatientModal />
          
          <Link href="/reception/queue" className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary/90 transition-colors gap-1.5">
            Open Review Queue
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Active Queue Card */}
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Queue List
            </span>
            <UserCheck className="h-4 w-4 text-accentBlue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900 dark:text-white">{activeQueueCount}</div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
              Patients currently waiting or in progress
            </p>
          </CardContent>
        </Card>

        {/* Pending Referrals Card */}
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Pending Submissions
            </span>
            <FileCheck className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900 dark:text-white">{pendingDocsCount}</div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
              Referrals requiring receptionist approval
            </p>
          </CardContent>
        </Card>

        {/* Routed Today Card */}
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Routed Today
            </span>
            <ArrowRightLeft className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900 dark:text-white">{todayRoutedCount}</div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
              Patients successfully triaged since midnight
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Welcome and Guidelines Panel */}
        <Card className="lg:col-span-7 border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/80">
            <CardTitle className="text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-accentBlue-500" />
              Receptionist Operational Guide
            </CardTitle>
            <CardDescription className="text-xs">
              Key front-desk protocols for validating patient documents
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4 text-sm leading-relaxed text-slate-600 dark:text-slate-350">
            <p>
              Receptionists serve as the critical entry point to KlinikAid. Your workflows directly impact patient safety, data integrity, and department wait times:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Validate Patient Info:</strong> Compare the patient name, birthdate, and physician signature on uploaded files with their digital profile before approving.
              </li>
              <li>
                <strong className="text-slate-800 dark:text-slate-200">AI Confidence Indicators:</strong> Submissions flagged with lower confidence score (&lt; 85%) display in the <strong className="text-amber-600">Staff Review</strong> column. Pay close attention to their parameters.
              </li>
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Routing & Vitals:</strong> When approving a document, record any vitals (BP, weight, temperature) provided by the patient to assist the medical technologists.
              </li>
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Rejections:</strong> Mismatched or illegible documents should be rejected with a detailed message of at least 20 characters so patients can resubmit.
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Recent Triage Waitlist Panel */}
        <Card className="lg:col-span-5 border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/80">
            <CardTitle className="text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <History className="h-5 w-5 text-indigo-500" />
              Recent Triage Activity
            </CardTitle>
            <CardDescription className="text-xs">
              Latest patients routed to clinical departments
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 p-0">
            <div className="max-h-[300px] overflow-y-auto px-4 pb-4 space-y-3.5">
              {recentQueue.length === 0 ? (
                <div className="text-center py-12 text-slate-400 dark:text-slate-500 text-xs italic">
                  No patient queue records today
                </div>
              ) : (
                recentQueue.map((entry) => (
                  <div key={entry.id} className="flex justify-between items-start border-b border-slate-100 dark:border-slate-900 pb-3 last:border-0 last:pb-0">
                    <div className="space-y-1 text-xs">
                      <p className="font-bold text-slate-900 dark:text-white">
                        {entry.patient ? `${entry.patient.first_name} ${entry.patient.last_name}` : "Unknown Patient"}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium">
                        <span className="uppercase text-accentBlue-600 dark:text-accentBlue-400 bg-accentBlue-50 dark:bg-accentBlue-950/30 px-1.5 py-0.5 rounded font-mono">
                          {getQueueNumber(entry.triage_notes)}
                        </span>
                        <span className="capitalize">{entry.department}</span>
                        <span className="flex items-center gap-0.5 text-slate-400">
                          <Clock className="h-3 w-3" />
                          {formatPhTime(entry.created_at)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                      <Badge className={`text-[9px] font-bold px-1.5 py-0.5 uppercase ${getPriorityBadgeClass(entry.priority_level)}`}>
                        {entry.priority_level}
                      </Badge>
                      <Badge className={`text-[9px] font-bold px-1.5 py-0.5 uppercase ${getStatusBadgeClass(entry.status)}`}>
                        {entry.status}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
