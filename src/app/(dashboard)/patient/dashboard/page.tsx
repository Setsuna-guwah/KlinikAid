import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { 
  Heart, 
  Bot, 
  Upload, 
  History, 
  FileText,
  AlertCircle
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

export default async function PatientDashboardPage() {
  const supabase = createClient();

  // 1. Get current authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 2. Fetch patient record linked via profile_id
  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id, first_name, last_name, email")
    .eq("profile_id", user.id)
    .single();

  if (patientError || !patient) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Profile Configuration Error</AlertTitle>
          <AlertDescription>
            We could not retrieve your patient record details. Please contact clinic staff to link your authentication account.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // 3. Fetch metrics in parallel
  const [
    activeQueueResult,
    documentsCountResult,
    resultsCountResult
  ] = await Promise.all([
    // Active Queue entries
    supabase
      .from("patient_queue")
      .select("id, status, department, priority_level, triage_notes, created_at")
      .eq("patient_id", patient.id)
      .in("status", ["waiting", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1),

    // Total and pending documents
    supabase
      .from("documents")
      .select("id, status"),

    // Results count
    supabase
      .from("department_records")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patient.id)
  ]);

  const activeQueue = activeQueueResult.data?.[0] || null;
  
  // Filter documents in memory for patient scoping
  const patientDocs = (documentsCountResult.data || []) as { id: string; status: string }[];
  const totalSubmissions = patientDocs.length;
  const pendingSubmissions = patientDocs.filter(d => d.status === "pending").length;

  const resultsCount = resultsCountResult.count || 0;

  // Helpers to parse queue number
  const getQueueNumber = (triageNotesStr: string | null) => {
    if (!triageNotesStr) return "—";
    try {
      const parsed = JSON.parse(triageNotesStr);
      return parsed.queue_number || "—";
    } catch {
      return "—";
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "waiting":
        return "bg-accentBlue-100 text-accentBlue-800 dark:bg-accentBlue-900/30 dark:text-accentBlue-400";
      case "in_progress":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400";
      default:
        return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Welcome, {patient.first_name}!
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Your personal health results and RAG-assisted inquiry portal
        </p>
      </div>

      {/* Main Welcome Card */}
      <Card className="border border-slate-200/80 dark:border-slate-800 shadow-md">
        <CardHeader className="flex flex-row items-center gap-4 bg-slate-50/55 dark:bg-slate-900/30 pb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
            <Heart className="h-5 w-5 fill-emerald-600" />
          </div>
          <div>
            <CardTitle>Welcome to KlinikAid</CardTitle>
            <CardDescription>All your laboratory results, referral submissions, and clinic guides in one place</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div className="p-4 border border-slate-200/60 dark:border-slate-800 rounded-lg space-y-2 text-center flex flex-col items-center justify-center">
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Queue Status</span>
              {activeQueue ? (
                <div className="flex flex-col items-center gap-1.5 pt-1">
                  <Badge className="font-mono text-xs px-2 py-0.5 bg-accentBlue-600 text-white">
                    {getQueueNumber(activeQueue.triage_notes)}
                  </Badge>
                  <Badge className={`text-[9px] font-bold uppercase ${getStatusBadgeClass(activeQueue.status)}`}>
                    {activeQueue.status}
                  </Badge>
                </div>
              ) : (
                <p className="text-sm font-semibold text-slate-500 py-2">Not In Queue</p>
              )}
            </div>
            
            <div className="p-4 border border-slate-200/60 dark:border-slate-800 rounded-lg space-y-2 text-center flex flex-col items-center justify-center">
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Pending Referrals</span>
              <p className="text-2xl font-bold text-slate-900 dark:text-white pt-1">{pendingSubmissions}</p>
              <p className="text-[9px] text-slate-400">Waiting for review</p>
            </div>

            <div className="p-4 border border-slate-200/60 dark:border-slate-800 rounded-lg space-y-2 text-center flex flex-col items-center justify-center">
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Total Submissions</span>
              <p className="text-2xl font-bold text-slate-900 dark:text-white pt-1">{totalSubmissions}</p>
              <p className="text-[9px] text-slate-400">Historical uploads</p>
            </div>

            <div className="p-4 border border-slate-200/60 dark:border-slate-800 rounded-lg space-y-2 text-center flex flex-col items-center justify-center">
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Available Results</span>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 pt-1">{resultsCount}</p>
              <p className="text-[9px] text-slate-400">Released parameters</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Navigation Shortcut Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {/* Chat Card */}
        <Link href="/patient/chat" className="group">
          <Card className="h-full border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-accentBlue-500/55 dark:hover:border-accentBlue-500/55 transition-all">
            <CardHeader className="flex flex-row items-center gap-3.5 pb-2">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accentBlue-50 text-accentBlue-600 dark:bg-accentBlue-950/30 dark:text-accentBlue-400 group-hover:scale-110 transition-transform">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold">Ask AI Assistant</CardTitle>
                <CardDescription className="text-[11px]">24/7 clinic info chatbot</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Inquire about laboratory operating hours, requirements, test preparations, and guidelines.
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* Submit Card */}
        <Link href="/patient/submit" className="group">
          <Card className="h-full border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-emerald-500/55 dark:hover:border-emerald-500/55 transition-all">
            <CardHeader className="flex flex-row items-center gap-3.5 pb-2">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400 group-hover:scale-110 transition-transform">
                <Upload className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold">Submit Referral</CardTitle>
                <CardDescription className="text-[11px]">Upload laboratory slips</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Upload diagnostic referrals and laboratory requests directly from your browser.
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* Submissions Tracker Card */}
        <Link href="/patient/submissions" className="group">
          <Card className="h-full border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-indigo-500/55 dark:hover:border-indigo-500/55 transition-all">
            <CardHeader className="flex flex-row items-center gap-3.5 pb-2">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                <History className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold">Track Status</CardTitle>
                <CardDescription className="text-[11px]">Queue & document tracker</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Check active review states of your uploaded documents and see live queue waiting lists.
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* Results Card */}
        <Link href="/patient/results" className="group">
          <Card className="h-full border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-purple-500/55 dark:hover:border-purple-500/55 transition-all">
            <CardHeader className="flex flex-row items-center gap-3.5 pb-2">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400 group-hover:scale-110 transition-transform">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold">My Lab Results</CardTitle>
                <CardDescription className="text-[11px]">Released laboratory values</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Access your official medical lab results complete with safety reference range metrics.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
