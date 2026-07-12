import React from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/helpers";
import { getPhtStartOfToday } from "@/lib/utils";
import DepartmentChart from "./DepartmentChart";
import { 
  Users, 
  FileText, 
  UserCheck, 
  MessageSquare, 
  Activity, 
  ShieldAlert 
} from "lucide-react";

export const dynamic = "force-dynamic";

// Format Philippine Time (UTC+8) from UTC ISO String
function formatPhTime(utcString: string) {
  const date = new Date(utcString);
  const phDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  
  // Format as YYYY-MM-DD HH:MM:SS
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = phDate.getUTCFullYear();
  const month = pad(phDate.getUTCMonth() + 1);
  const day = pad(phDate.getUTCDate());
  const hours = pad(phDate.getUTCHours());
  const minutes = pad(phDate.getUTCMinutes());
  const seconds = pad(phDate.getUTCSeconds());
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Get Badge colors for audit logs
function getEventBadgeClass(eventType: string) {
  const type = eventType.toUpperCase();
  if (type.includes("SUCCESS") || type.includes("CREATED") || type.includes("REGISTERED") || type.includes("ACTIVATED")) {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200/50";
  }
  if (type.includes("FAILED") || type.includes("UNAUTHORIZED") || type.includes("DEACTIVATED")) {
    return "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400 border border-rose-200/50";
  }
  if (type.includes("LOGIN") || type.includes("LOGOUT")) {
    return "bg-accentBlue-100 text-accentBlue-800 dark:bg-accentBlue-900/30 dark:text-accentBlue-400 border border-accentBlue-200/50";
  }
  return "bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:text-slate-300 border border-slate-200/50";
}

export default async function AdminDashboardPage() {
  // Enforce admin privileges
  await requireRole(["admin"]);
  const supabase = createClient();

  // Calculate start of today in UTC+8 terms, converted back to UTC ISO for database query
  const startOfToday = getPhtStartOfToday();


  // Fetch metrics in parallel
  const [
    todayPatientsResult,
    pendingDocsResult,
    activeStaffResult,
    todayChatbotQueriesResult,
    recentLogsResult,
    departmentBreakdownResult
  ] = await Promise.all([
    supabase
      .from("patient_queue")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfToday),

    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),

    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .neq("role", "patient")
      .eq("is_active", true),

    supabase
      .from("chatbot_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfToday),

    supabase
      .from("system_logs")
      .select(`
        id,
        user_id,
        event_type,
        description,
        ip_address,
        metadata,
        created_at,
        profiles:user_id (
          full_name,
          role
        )
      `)
      .order("created_at", { ascending: false })
      .limit(10),

    supabase
      .from("patient_queue")
      .select("department")
      .gte("created_at", startOfToday)
  ]);

  const todayPatients = todayPatientsResult.count || 0;
  const pendingDocs = pendingDocsResult.count || 0;
  const activeStaff = activeStaffResult.count || 0;
  const todayChatbotQueries = todayChatbotQueriesResult.count || 0;
  const recentLogs = (recentLogsResult.data || []) as unknown as {
    id: string;
    user_id: string | null;
    event_type: string;
    description: string;
    ip_address: string | null;
    created_at: string;
    profiles: {
      full_name: string;
      role: string;
    } | null;
  }[];

  // Form department workload metrics
  const deptCounts: Record<string, number> = {
    laboratory: 0,
    imaging: 0,
    ultrasound: 0,
    ecg: 0
  };

  if (departmentBreakdownResult.data) {
    departmentBreakdownResult.data.forEach((item) => {
      if (item.department && deptCounts[item.department] !== undefined) {
        deptCounts[item.department]++;
      }
    });
  }

  const departmentBreakdown = Object.entries(deptCounts).map(([dept, count]) => ({
    department: dept,
    count
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Admin Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Clinic administrative control and oversight panel
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* KPI: Today's Patients */}
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Today&apos;s Patients
            </span>
            <Users className="h-4 w-4 text-accentBlue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{todayPatients}</div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
              Patients queued today
            </p>
          </CardContent>
        </Card>

        {/* KPI: Pending Document Reviews */}
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Pending Reviews
            </span>
            <FileText className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{pendingDocs}</div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
              Referrals awaiting validation
            </p>
          </CardContent>
        </Card>

        {/* KPI: Active Staff Members */}
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Staff
            </span>
            <UserCheck className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{activeStaff}</div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
              Personnel with active access
            </p>
          </CardContent>
        </Card>

        {/* KPI: Chatbot Queries Today */}
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Chatbot Queries
            </span>
            <MessageSquare className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{todayChatbotQueries}</div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
              Conversations processed today
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        {/* Workload breakdown chart */}
        <Card className="col-span-4 border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Activity className="h-4 w-4 text-accentBlue-600" />
              Department Workload
            </CardTitle>
            <CardDescription className="text-xs">
              Today&apos;s queue traffic per medical department
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DepartmentChart data={departmentBreakdown} />
          </CardContent>
        </Card>

        {/* Audit event log */}
        <Card className="col-span-3 border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-600" />
              System Event Log
            </CardTitle>
            <CardDescription className="text-xs">
              Recent administrative and security actions (UTC+8)
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[300px] overflow-y-auto px-4 pb-4 space-y-4">
              {recentLogs.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">No recent events logged.</p>
              ) : (
                recentLogs.map((log) => (
                  <div key={log.id} className="flex gap-3 text-xs leading-normal border-b border-slate-100 dark:border-slate-800/80 pb-3 last:border-0 last:pb-0">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <Badge className={`text-[9px] font-semibold py-0 px-1.5 uppercase ${getEventBadgeClass(log.event_type)}`}>
                          {log.event_type.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {formatPhTime(log.created_at)}
                        </span>
                      </div>
                      <p className="text-slate-700 dark:text-slate-300 font-medium">
                        {log.description}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span>User: {log.profiles?.full_name || "System"}</span>
                        {log.ip_address && (
                          <>
                            <span>•</span>
                            <span className="font-mono">IP: {log.ip_address}</span>
                          </>
                        )}
                      </div>
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
