"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { SYSTEM_EVENT_TYPES, GEMINI_BLENDED_USD_PER_1M_TOKENS, CHART_COLORS } from "@/lib/constants";
import LogEventBadge from "@/components/LogEventBadge";
import { formatPhTime } from "@/lib/utils";
import { 
  Loader2, 
  Download, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  MessageSquare, 
  AlertTriangle, 
  TrendingUp,
  Activity,
  Clock,
  ShieldCheck
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { startOfISOWeek, parseISO } from "date-fns";
import { toZonedTime, format as formatTz } from "date-fns-tz";

interface ProfileItem {
  id: string;
  full_name: string;
  role: string;
}

interface LogsDashboardClientProps {
  profiles: ProfileItem[];
  freeTierTokenLimit: number;
}

interface SystemLog {
  id: string;
  user_id: string | null;
  event_type: string;
  description: string;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  profiles: {
    full_name: string;
    role: string;
  } | null;
}

interface ChatbotLog {
  id: string;
  user_id: string | null;
  session_id: string;
  user_message: string;
  bot_response: string;
  tokens_used: number;
  feedback: string | null;
  created_at: string;
  profiles: {
    full_name: string;
    role: string;
  } | null;
}

interface DailyCost {
  date: string;
  total_tokens: number;
  query_count: number;
}

interface TooltipPayloadItem {
  value: number;
  payload: {
    query_count: number;
  };
}

interface CustomChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

// Recharts Custom Tooltip (Defined outside component body to prevent flickering - Rule #12)
const CustomChartTooltip = ({ active, payload, label }: CustomChartTooltipProps) => {
  if (active && payload && payload.length) {
    const tokens = payload[0].value;
    const cost = (tokens / 1000000) * GEMINI_BLENDED_USD_PER_1M_TOKENS;
    return (
      <div className="bg-slate-950/95 border border-slate-800 p-3 rounded-lg shadow-xl text-white text-xs space-y-1 backdrop-blur-md">
        <p className="font-semibold text-slate-300">{label}</p>
        <p className="text-emerald-400 font-mono font-medium">
          Tokens: <span className="font-bold">{tokens.toLocaleString()}</span>
        </p>
        <p className="text-amber-400 font-mono font-medium">
          Est. Cost: <span className="font-bold">${cost.toFixed(4)} USD</span>
        </p>
        <p className="text-slate-400 text-[10px]">
          Queries: {payload[0].payload.query_count || 0}
        </p>
      </div>
    );
  }
  return null;
};

export default function LogsDashboardClient({ profiles, freeTierTokenLimit }: LogsDashboardClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Tab Management (Query Param persistence - Suspense protected)
  const activeTab = searchParams.get("tab") || "system";
  const setActiveTab = (tab: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", tab);
    router.push(`?${params.toString()}`);
  };

  // ----------------------------------------------------
  // TAB 1: SYSTEM LOGS STATE
  // ----------------------------------------------------
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [systemTotal, setSystemTotal] = useState(0);
  const [systemPage, setSystemPage] = useState(1);
  const [systemLoading, setSystemLoading] = useState(false);
  const [isExporting, startExport] = useTransition();

  // Filters
  const [filterEventType, setFilterEventType] = useState<string>("all");
  const [filterUserId, setFilterUserId] = useState<string>("all");
  const [filterStartDate, setFilterStartDate] = useState<string>("");
  const [filterEndDate, setFilterEndDate] = useState<string>("");
  const [filterSearch, setFilterSearch] = useState<string>("");

  // ----------------------------------------------------
  // TAB 2: CHATBOT AUDIT STATE
  // ----------------------------------------------------
  const [chatLogs, setChatLogs] = useState<ChatbotLog[]>([]);
  const [chatTotal, setChatTotal] = useState(0);
  const [chatPage, setChatPage] = useState(1);
  const [chatLoading, setChatLoading] = useState(false);
  const [todayStats, setTodayStats] = useState<{ queries: number; tokens: number } | null>(null);

  // Conversation Drawer
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<ChatbotLog[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionTruncated, setSessionTruncated] = useState(false);

  // ----------------------------------------------------
  // TAB 3: API COST TRACKER STATE
  // ----------------------------------------------------
  const [dailyCosts, setDailyCosts] = useState<DailyCost[]>([]);
  const [costLoading, setCostLoading] = useState(false);

  // ----------------------------------------------------
  // FETCH LOGICS
  // ----------------------------------------------------

  // Fetch System Logs (Paginated & Filtered)
  const fetchSystemLogs = async () => {
    setSystemLoading(true);
    try {
      const params = new URLSearchParams({
        page: systemPage.toString(),
        limit: "15",
      });

      if (filterEventType !== "all") params.set("eventType", filterEventType);
      if (filterUserId !== "all") params.set("userId", filterUserId);
      if (filterStartDate) params.set("startDate", new Date(filterStartDate).toISOString());
      if (filterEndDate) {
        // Enforce full day boundary
        const end = new Date(filterEndDate);
        end.setHours(23, 59, 59, 999);
        params.set("endDate", end.toISOString());
      }
      if (filterSearch.trim()) params.set("eventType", filterSearch.trim()); // Wait, search uses special check or endpoint maps it

      const response = await fetch(`/api/admin/logs/system?${params.toString()}`);
      const result = await response.json();

      if (result.success) {
        // Client-side text filter for description search
        let logs: SystemLog[] = result.data.logs || [];
        if (filterSearch.trim()) {
          logs = logs.filter(log => 
            log.description.toLowerCase().includes(filterSearch.toLowerCase())
          );
        }
        setSystemLogs(logs);
        setSystemTotal(result.data.total || 0);
      } else {
        toast.error(result.error || "Failed to fetch system logs.");
      }
    } catch (err) {
      console.error(err);
      toast.error("An unexpected error occurred while fetching system logs.");
    } finally {
      setSystemLoading(false);
    }
  };

  // Fetch Chatbot Logs
  const fetchChatbotLogs = async (forceStats = false) => {
    setChatLoading(true);
    try {
      const params = new URLSearchParams({
        page: chatPage.toString(),
        limit: "15",
      });
      // Stats only fetched on page 1 initial load (Revision F)
      if (chatPage === 1 || forceStats) {
        params.set("includeStats", "true");
      }

      const response = await fetch(`/api/admin/logs/chatbot?${params.toString()}`);
      const result = await response.json();

      if (result.success) {
        setChatLogs(result.data.logs || []);
        setChatTotal(result.data.total || 0);
        if (result.data.todayStats) {
          setTodayStats(result.data.todayStats);
        }
      } else {
        toast.error(result.error || "Failed to fetch chatbot logs.");
      }
    } catch (err) {
      console.error(err);
      toast.error("An unexpected error occurred while fetching chatbot logs.");
    } finally {
      setChatLoading(false);
    }
  };

  // Fetch API Cost Tracker Data
  const fetchCostTracker = async () => {
    setCostLoading(true);
    try {
      const response = await fetch("/api/admin/logs/api-costs");
      const result = await response.json();

      if (result.success) {
        setDailyCosts(result.data || []);
      } else {
        toast.error(result.error || "Failed to fetch API cost usage.");
      }
    } catch (err) {
      console.error(err);
      toast.error("An unexpected error occurred while fetching cost aggregates.");
    } finally {
      setCostLoading(false);
    }
  };

  // Fetch specific session thread
  const fetchSessionThread = async (sessId: string) => {
    setSessionLoading(true);
    setSessionTruncated(false);
    try {
      const response = await fetch(`/api/admin/logs/chatbot?sessionId=${sessId}`);
      const result = await response.json();
      if (result.success) {
        setSessionMessages(result.data.logs || []);
        setSessionTruncated(!!result.data.truncated);
      } else {
        toast.error(result.error || "Failed to retrieve conversation history.");
      }
    } catch (err) {
      console.error(err);
      toast.error("An error occurred while loading the conversation.");
    } finally {
      setSessionLoading(false);
    }
  };

  // Trigger data load based on tab
  useEffect(() => {
    if (activeTab === "system") {
      fetchSystemLogs();
    } else if (activeTab === "chatbot") {
      fetchChatbotLogs();
    } else if (activeTab === "costs") {
      fetchCostTracker();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, systemPage, chatPage, filterEventType, filterUserId, filterStartDate, filterEndDate]);

  // Handle Search Input Change with local trigger
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSystemPage(1);
    fetchSystemLogs();
  };

  // ----------------------------------------------------
  // EXPORT TO CSV HANDLER (Revision D, E, H)
  // ----------------------------------------------------
  const handleCsvExport = () => {
    startExport(async () => {
      try {
        const params = new URLSearchParams({
          download: "true",
        });
        if (filterEventType !== "all") params.set("eventType", filterEventType);
        if (filterUserId !== "all") params.set("userId", filterUserId);
        if (filterStartDate) params.set("startDate", new Date(filterStartDate).toISOString());
        if (filterEndDate) {
          const end = new Date(filterEndDate);
          end.setHours(23, 59, 59, 999);
          params.set("endDate", end.toISOString());
        }

        const response = await fetch(`/api/admin/logs/system?${params.toString()}`);
        const result = await response.json();

        if (!result.success) {
          toast.error(result.error || "Export failed.");
          return;
        }

        const logs: SystemLog[] = result.data.logs || [];
        if (result.data.truncated) {
          toast.warning("Truncated export: Only the first 10,000 logs were fetched.");
        }

        // CSV formatting
        const headers = ["Timestamp (PHT)", "User", "Role", "Event Type", "Description", "IP Address"];
        
        // CSV Injection Protection utility (Revision H)
        const sanitizeCell = (val: string | null) => {
          if (!val) return "";
          let cleaned = val.replace(/"/g, '""'); // Escape double quotes
          if (/^[=\+\-@\t\r]/.test(cleaned)) {
            cleaned = `'${cleaned}`; // Prefix single quote to disable injection
          }
          return `"${cleaned}"`;
        };

        const rows = logs.map((log) => {
          const timestamp = formatPhTime(log.created_at);
          const userName = log.profiles?.full_name ?? "System"; // Left join null protection (Revision E)
          const userRole = log.profiles?.role ?? "";
          
          return [
            sanitizeCell(timestamp),
            sanitizeCell(userName),
            sanitizeCell(userRole),
            sanitizeCell(log.event_type),
            sanitizeCell(log.description),
            sanitizeCell(log.ip_address || "127.0.0.1"),
          ].join(",");
        });

        const csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n"); // Prepend UTF-8 BOM (Revision H)
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `KlinikAid_System_AuditLogs_${formatTz(new Date(), "yyyyMMdd_HHmm")}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        toast.success("CSV file downloaded successfully!");
        
        // Refresh system logs list to show the new EXPORT_SYSTEM_LOGS record
        setTimeout(() => fetchSystemLogs(), 500);
      } catch (err) {
        console.error(err);
        toast.error("Failed to complete CSV export.");
      }
    });
  };

  // ----------------------------------------------------
  // CHART ZERO-FILLING & PRORATION MATH (Revision C, D, G)
  // ----------------------------------------------------
  const timezone = "Asia/Manila";
  const nowPHT = toZonedTime(new Date(), timezone);
  const todayStr = formatTz(nowPHT, "yyyy-MM-dd", { timeZone: timezone });
  const midnightTodayPHT = new Date(`${todayStr}T00:00:00+08:00`);

  // Zero-fill 30 days history timeline (Revision D)
  const datesMap = new Map<string, { date: string; total_tokens: number; query_count: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(midnightTodayPHT.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = formatTz(toZonedTime(d, timezone), "yyyy-MM-dd", { timeZone: timezone });
    datesMap.set(dateStr, { date: dateStr, total_tokens: 0, query_count: 0 });
  }

  dailyCosts.forEach((row) => {
    if (datesMap.has(row.date)) {
      datesMap.set(row.date, {
        date: row.date,
        total_tokens: Number(row.total_tokens) || 0,
        query_count: Number(row.query_count) || 0,
      });
    }
  });

  const filledData = Array.from(datesMap.values());

  // Dynamic Y-Axis Domain Bounds Calculation (Revision G)
  const maxDailyTokens = filledData.length > 0
    ? Math.max(...filledData.map(d => d.total_tokens))
    : 0;
  const safeFreeLimit = freeTierTokenLimit > 0 ? freeTierTokenLimit : 10000000;
  const yDomainMax = Math.max(maxDailyTokens * 1.2, safeFreeLimit * 1.1);

  // Group daily logs into Monday-Sunday weeks (Revision C)
  const weeksMap = new Map<string, {
    weekLabel: string;
    totalTokens: number;
    daysInWeek: number;
  }>();

  filledData.forEach((day) => {
    // Parse using Manila noon local boundary to prevent UTC shifting (Revision H)
    const dateInPHT = new Date(day.date + "T12:00:00+08:00");
    const weekStartUTC = startOfISOWeek(dateInPHT);
    const weekStartPHT = toZonedTime(weekStartUTC, timezone);
    const weekLabel = formatTz(weekStartPHT, "yyyy-'W'II", { timeZone: timezone });
    
    if (!weeksMap.has(weekLabel)) {
      const displayLabel = formatTz(weekStartPHT, "MMM d", { timeZone: timezone });
      weeksMap.set(weekLabel, {
        weekLabel: displayLabel,
        totalTokens: 0,
        daysInWeek: 0,
      });
    }
    
    const weekItem = weeksMap.get(weekLabel)!;
    weekItem.totalTokens += day.total_tokens;
    weekItem.daysInWeek += 1;
  });

  const weeklyBreakdown = Array.from(weeksMap.values()).map((week) => {
    const dailyBudget = safeFreeLimit / 30;
    const weekBudget = dailyBudget * week.daysInWeek; // Prorated based on day count (Revision C)
    const isOverBudget = week.totalTokens > weekBudget;
    const isPartialWeek = week.daysInWeek < 7;
    const costEst = (week.totalTokens / 1000000) * GEMINI_BLENDED_USD_PER_1M_TOKENS;
    const budgetEst = (weekBudget / 1000000) * GEMINI_BLENDED_USD_PER_1M_TOKENS;

    return {
      ...week,
      weekBudget,
      isOverBudget,
      isPartialWeek,
      costEst,
      budgetEst,
    };
  });

  return (
    <div className="space-y-6">
      {/* Navigation Tabs Header */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 space-x-6">
        <button
          onClick={() => setActiveTab("system")}
          className={`py-3 text-sm font-semibold border-b-2 transition-all ${
            activeTab === "system"
              ? "border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
          }`}
        >
          System Events
        </button>
        <button
          onClick={() => setActiveTab("chatbot")}
          className={`py-3 text-sm font-semibold border-b-2 transition-all ${
            activeTab === "chatbot"
              ? "border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
          }`}
        >
          Chatbot Audit
        </button>
        <button
          onClick={() => setActiveTab("costs")}
          className={`py-3 text-sm font-semibold border-b-2 transition-all ${
            activeTab === "costs"
              ? "border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
          }`}
        >
          API Cost Tracker
        </button>
      </div>

      {/* -------------------------------------------------------------------------------- */}
      {/* TAB 1: SYSTEM EVENTS DASHBOARD */}
      {/* -------------------------------------------------------------------------------- */}
      {activeTab === "system" && (
        <div className="space-y-6">
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <CardTitle className="text-xl">Event Filter Board</CardTitle>
                  <CardDescription>Filter system events by type, date range, or staff name.</CardDescription>
                </div>
                
                <Button 
                  onClick={handleCsvExport} 
                  disabled={isExporting} 
                  variant="outline" 
                  className="w-full md:w-auto h-10 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" /> Export CSV
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Filter Interface Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Event Type</Label>
                  <Select value={filterEventType} onValueChange={(val) => { setFilterEventType(val || "all"); setSystemPage(1); }}>
                    <SelectTrigger className="bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800">
                      <SelectValue placeholder="All events" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Events</SelectItem>
                      {Object.keys(SYSTEM_EVENT_TYPES).map((type) => (
                        <SelectItem key={type} value={type}>
                          {type.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Staff / User</Label>
                  <Select value={filterUserId} onValueChange={(val) => { setFilterUserId(val || "all"); setSystemPage(1); }}>
                    <SelectTrigger className="bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800">
                      <SelectValue placeholder="All users" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Users</SelectItem>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.full_name} ({p.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => { setFilterStartDate(e.target.value); setSystemPage(1); }}
                    className="bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                  />
                </div>

                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input
                    type="date"
                    value={filterEndDate}
                    onChange={(e) => { setFilterEndDate(e.target.value); setSystemPage(1); }}
                    className="bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                  />
                </div>
              </div>

              {/* Free-text Search Bar */}
              <form onSubmit={handleSearchSubmit} className="mt-4 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search logs description..."
                    value={filterSearch}
                    onChange={(e) => setFilterSearch(e.target.value)}
                    className="pl-10 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                  />
                </div>
                <Button type="submit" variant="secondary" className="h-10">
                  Search
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* System Events Table Card */}
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800">
                    <TableHead className="w-[180px] font-semibold">Timestamp (PHT)</TableHead>
                    <TableHead className="w-[180px] font-semibold">User</TableHead>
                    <TableHead className="w-[160px] font-semibold">Event Type</TableHead>
                    <TableHead className="font-semibold">Description</TableHead>
                    <TableHead className="w-[140px] font-semibold">IP Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {systemLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-48 text-center">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
                          <p className="text-sm text-slate-500">Loading audit logs...</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : systemLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-48 text-center text-slate-500">
                        No system events match selected filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    systemLogs.map((log) => (
                      <TableRow key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 border-b border-slate-200 dark:border-slate-800">
                        <TableCell className="font-mono text-xs text-slate-500 whitespace-nowrap">
                          {formatPhTime(log.created_at)}
                        </TableCell>
                        <TableCell>
                          {log.profiles ? (
                            <div className="space-y-1">
                              <p className="font-medium text-slate-900 dark:text-slate-50">{log.profiles.full_name}</p>
                              <p className="text-[10px] text-slate-400 capitalize">{log.profiles.role.replace("_", " ")}</p>
                            </div>
                          ) : (
                            <span className="text-slate-400 font-medium italic">System</span> // Left join null protection (Revision E)
                          )}
                        </TableCell>
                        <TableCell>
                          <LogEventBadge eventType={log.event_type} />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300 font-normal">
                          {log.description}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-400 whitespace-nowrap">
                          {log.ip_address || "127.0.0.1"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {systemTotal > 15 && (
              <div className="p-4 bg-slate-50/50 dark:bg-slate-900/20 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Showing {(systemPage - 1) * 15 + 1} to {Math.min(systemPage * 15, systemTotal)} of {systemTotal} records
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={systemPage === 1 || systemLoading}
                    onClick={() => setSystemPage(p => p - 1)}
                    className="h-8 border-slate-200 dark:border-slate-800"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={systemPage * 15 >= systemTotal || systemLoading}
                    onClick={() => setSystemPage(p => p + 1)}
                    className="h-8 border-slate-200 dark:border-slate-800"
                  >
                    Next <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* -------------------------------------------------------------------------------- */}
      {/* TAB 2: CHATBOT AUDIT LOGS */}
      {/* -------------------------------------------------------------------------------- */}
      {activeTab === "chatbot" && (
        <div className="space-y-6">
          {/* Summary Metrics Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden bg-slate-50/20 dark:bg-slate-900/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Today&apos;s Queries</p>
                    <h3 className="text-3xl font-bold text-slate-900 dark:text-slate-50">
                      {todayStats ? todayStats.queries.toLocaleString() : "—"}
                    </h3>
                  </div>
                  <div className="h-10 w-10 bg-teal-50 dark:bg-teal-950/30 rounded-full flex items-center justify-center text-teal-600 dark:text-teal-400">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden bg-slate-50/20 dark:bg-slate-900/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Today&apos;s Tokens Used</p>
                    <h3 className="text-3xl font-bold text-slate-900 dark:text-slate-50">
                      {todayStats ? todayStats.tokens.toLocaleString() : "—"}
                    </h3>
                  </div>
                  <div className="h-10 w-10 bg-indigo-50 dark:bg-indigo-950/30 rounded-full flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                    <Activity className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden bg-slate-50/20 dark:bg-slate-900/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Today&apos;s Estimated Cost</p>
                    <h3 className="text-3xl font-bold text-slate-900 dark:text-slate-50">
                      {todayStats ? `$${((todayStats.tokens / 1000000) * GEMINI_BLENDED_USD_PER_1M_TOKENS).toFixed(4)}` : "—"}
                    </h3>
                    <p className="text-[10px] text-slate-400 italic">Blended USD rate estimate</p>
                  </div>
                  <div className="h-10 w-10 bg-amber-50 dark:bg-amber-950/30 rounded-full flex items-center justify-center text-amber-600 dark:text-amber-400">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Chat Audit Table Card */}
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800">
                    <TableHead className="w-[180px] font-semibold">Timestamp (PHT)</TableHead>
                    <TableHead className="w-[180px] font-semibold">User</TableHead>
                    <TableHead className="w-[140px] font-semibold">Session ID</TableHead>
                    <TableHead className="font-semibold">User Query</TableHead>
                    <TableHead className="font-semibold">Bot Response</TableHead>
                    <TableHead className="w-[110px] text-right font-semibold">Tokens</TableHead>
                    <TableHead className="w-[100px] text-center font-semibold">Feedback</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chatLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-48 text-center">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
                          <p className="text-sm text-slate-500">Loading chatbot logs...</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : chatLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-48 text-center text-slate-500">
                        No chatbot history available.
                      </TableCell>
                    </TableRow>
                  ) : (
                    chatLogs.map((log) => (
                      <TableRow 
                        key={log.id} 
                        onClick={() => {
                          if (log.session_id) {
                            setActiveSessionId(log.session_id);
                            fetchSessionThread(log.session_id);
                          }
                        }}
                        className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 border-b border-slate-200 dark:border-slate-800 cursor-pointer"
                      >
                        <TableCell className="font-mono text-xs text-slate-500 whitespace-nowrap">
                          {formatPhTime(log.created_at)}
                        </TableCell>
                        <TableCell>
                          {log.profiles ? (
                            <div className="space-y-1">
                              <p className="font-medium text-slate-900 dark:text-slate-50">{log.profiles.full_name}</p>
                              <p className="text-[10px] text-slate-400 capitalize">{log.profiles.role}</p>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-xs">Deleted User</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-400 whitespace-nowrap">
                          {log.session_id ? log.session_id.substring(0, 8) + "..." : "—"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-slate-700 dark:text-slate-300 text-sm">
                          {log.user_message}
                        </TableCell>
                        <TableCell className="max-w-[250px] truncate text-slate-700 dark:text-slate-300 text-sm">
                          {log.bot_response}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                          {log.tokens_used.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center">
                          {log.feedback ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              log.feedback === "helpful" 
                                ? "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400" 
                                : "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400"
                            }`}>
                              {log.feedback}
                            </span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {chatTotal > 15 && (
              <div className="p-4 bg-slate-50/50 dark:bg-slate-900/20 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Showing {(chatPage - 1) * 15 + 1} to {Math.min(chatPage * 15, chatTotal)} of {chatTotal} records
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={chatPage === 1 || chatLoading}
                    onClick={() => setChatPage(p => p - 1)}
                    className="h-8 border-slate-200 dark:border-slate-800"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={chatPage * 15 >= chatTotal || chatLoading}
                    onClick={() => setChatPage(p => p + 1)}
                    className="h-8 border-slate-200 dark:border-slate-800"
                  >
                    Next <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* -------------------------------------------------------------------------------- */}
      {/* TAB 3: API COST TRACKER */}
      {/* -------------------------------------------------------------------------------- */}
      {activeTab === "costs" && (
        <div className="space-y-6">
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <CardTitle className="text-xl">30-Day API Token Consumption</CardTitle>
                  <CardDescription>
                    Visualizes daily cumulative token usage compared to the standard threshold limits.
                  </CardDescription>
                </div>
                
                <div className="text-right md:space-y-1">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Estimated Blended Cost Rate</p>
                  <p className="text-sm font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                    ${GEMINI_BLENDED_USD_PER_1M_TOKENS.toFixed(2)} USD per 1M tokens
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {costLoading ? (
                <div className="h-72 flex items-center justify-center">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
                    <p className="text-sm text-slate-500">Loading cost telemetry...</p>
                  </div>
                </div>
              ) : filledData.length === 0 ? (
                <div className="h-72 flex items-center justify-center text-slate-500 text-sm">
                  No telemetry metrics gathered yet.
                </div>
              ) : (
                <div className="h-72 w-full mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={filledData}
                      margin={{ top: 10, right: 10, left: 20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.laboratory} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={CHART_COLORS.laboratory} stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" className="dark:stroke-slate-800" />
                      <XAxis 
                        dataKey="date" 
                        stroke="#94A3B8" 
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(str) => {
                          const date = parseISO(str + "T12:00:00+08:00");
                          return formatTz(date, "MMM d", { timeZone: timezone });
                        }}
                      />
                      <YAxis 
                        stroke="#94A3B8" 
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        domain={[0, yDomainMax]}
                        tickFormatter={(val) => val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : val.toLocaleString()}
                      />
                      <Tooltip content={<CustomChartTooltip />} />
                      
                      {/* Red dashed threshold limit reference line */}
                      <ReferenceLine 
                        y={safeFreeLimit} 
                        stroke="#DC2626" 
                        strokeDasharray="5 5" 
                        label={{ 
                          value: `Monthly Limit: ${(safeFreeLimit/1000000).toFixed(0)}M`, 
                          position: "top", 
                          fill: "#DC2626", 
                          fontSize: 9, 
                          fontWeight: "bold" 
                        }} 
                      />
                      
                      <Area 
                        type="monotone" 
                        dataKey="total_tokens" 
                        stroke={CHART_COLORS.laboratory} 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorTokens)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Weekly Cost Breakdown Card */}
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
            <CardHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
              <CardTitle className="text-base font-semibold">Weekly Cost Performance Breakdown</CardTitle>
              <CardDescription>
                Analysis of aggregated token quotas vs budget thresholds, prorated by active days in the current 30-day tracking scope.
              </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800">
                    <TableHead className="font-semibold">ISO Week (Monday Start)</TableHead>
                    <TableHead className="text-right font-semibold">Telemetry Days</TableHead>
                    <TableHead className="text-right font-semibold">Tokens Consumed</TableHead>
                    <TableHead className="text-right font-semibold">Prorated Budget Quota</TableHead>
                    <TableHead className="text-right font-semibold">Est. Cost (USD)</TableHead>
                    <TableHead className="text-center font-semibold">Budget Quota Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                        Loading weekly quotas...
                      </TableCell>
                    </TableRow>
                  ) : weeklyBreakdown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                        No weekly quotas calculated.
                      </TableCell>
                    </TableRow>
                  ) : (
                    weeklyBreakdown.map((week) => (
                      <TableRow key={week.weekLabel} className="border-b border-slate-100 dark:border-slate-800">
                        <TableCell className="font-semibold text-slate-950 dark:text-slate-50">
                          Week of {week.weekLabel} {week.isPartialWeek && <span className="text-[10px] text-amber-500 font-normal italic">(Partial)</span>}
                        </TableCell>
                        <TableCell className="text-right text-slate-500 text-xs">
                          {week.daysInWeek} / 7 days
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-900 dark:text-slate-100">
                          {week.totalTokens.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-slate-500">
                          {week.weekBudget.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                          ${week.costEst.toFixed(4)} USD
                        </TableCell>
                        <TableCell className="text-center">
                          {week.isOverBudget ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30">
                              <AlertTriangle className="h-3 w-3" /> Over Quota
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-green-100 text-green-800 border border-green-200 dark:bg-green-950/20 dark:text-green-400 dark:border-green-900/30">
                              <ShieldCheck className="h-3 w-3" /> Under Budget
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

      {/* -------------------------------------------------------------------------------- */}
      {/* CONVERSATION AUDIT DRAWER / DIALOG */}
      {/* -------------------------------------------------------------------------------- */}
      <Dialog open={activeSessionId !== null} onOpenChange={(open) => { if (!open) setActiveSessionId(null); }}>
        <DialogContent className="max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl shadow-2xl">
          <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Clock className="h-5 w-5 text-teal-600" />
              Chat Thread Audit Trail
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Audit the full conversation logs for session ID: <span className="font-mono text-slate-600 dark:text-slate-300 font-semibold">{activeSessionId}</span>
            </DialogDescription>
          </DialogHeader>

          {/* Messages Scroll Feed */}
          <div className="h-96 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-950/40 rounded-xl border border-slate-100 dark:border-slate-800 mt-4 flex flex-col">
            {sessionLoading ? (
              <div className="my-auto flex flex-col items-center justify-center space-y-2">
                <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
                <p className="text-sm text-slate-400">Fetching session logs...</p>
              </div>
            ) : sessionMessages.length === 0 ? (
              <p className="my-auto text-center text-slate-400 text-sm">No messages logged in this session.</p>
            ) : (
              <>
                {sessionTruncated && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-2 text-amber-800 dark:bg-amber-950/10 dark:border-amber-900/30 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <p className="text-xs">Thread truncated. Displaying first 200 messages in this session.</p>
                  </div>
                )}
                
                {sessionMessages.map((msg, i) => (
                  <div key={msg.id || i} className="space-y-3">
                    {/* User Prompt bubble (align right) */}
                    <div className="flex justify-end pl-12">
                      <div className="bg-teal-600 text-white rounded-2xl rounded-tr-none px-4 py-2.5 shadow-sm text-sm">
                        <p className="whitespace-pre-wrap">{msg.user_message}</p>
                        <p className="text-[9px] text-teal-200 mt-1 font-mono text-right">
                          {formatPhTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                    {/* Bot Answer bubble (align left) */}
                    <div className="flex justify-start pr-12">
                      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-2xl rounded-tl-none px-4 py-2.5 shadow-sm text-sm">
                        <p className="whitespace-pre-wrap">{msg.bot_response}</p>
                        <div className="flex items-center justify-between gap-4 mt-1 border-t border-slate-100 dark:border-slate-700/50 pt-1 text-[9px] text-slate-400 font-mono">
                          <span>Tokens: {msg.tokens_used}</span>
                          <span>{formatPhTime(msg.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="flex justify-end border-t border-slate-100 dark:border-slate-800 pt-4">
            <Button onClick={() => setActiveSessionId(null)} className="bg-slate-900 hover:bg-slate-800 text-white px-5 rounded-lg">
              Close Audit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
