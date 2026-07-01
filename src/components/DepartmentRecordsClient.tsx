"use client";

import React, { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { 
  Users, 
  History, 
  Search, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  FileText, 
  ChevronRight, 
} from "lucide-react";
import { format } from "date-fns";
import { DEPARTMENTS } from "@/lib/constants";

interface QueuePatient {
  id: string;
  first_name: string;
  last_name: string;
  gender: string;
  date_of_birth: string;
}

interface QueueItem {
  id: string;
  patient_id: string;
  department: string;
  status: string;
  triage_notes: {
    queue_number?: string;
    vitals?: {
      blood_pressure?: string | null;
      weight_kg?: number | null;
      temperature_c?: number | null;
    } | null;
    notes?: string;
  } | null;
  created_at: string;
  patient: QueuePatient | null;
}

interface HistoryItem {
  id: string;
  patient_id: string;
  recorder_id: string;
  department: string;
  test_type: string;
  test_name: string;
  test_value: string;
  unit: string | null;
  reference_range_min: number | null;
  reference_range_max: number | null;
  is_flagged: boolean;
  notes: string | null;
  created_at: string;
  patient: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;
  recorder: {
    id: string;
    full_name: string;
  } | null;
}

interface DepartmentRecordsClientProps {
  initialQueue: QueueItem[];
  initialHistory: HistoryItem[];
  activeDept: string;
  userRole: string;
}

export default function DepartmentRecordsClient({
  initialQueue,
  initialHistory,
  activeDept,
  userRole
}: DepartmentRecordsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [activeTab, setActiveTab] = useState<"queue" | "history">("queue");
  const [searchTerm, setSearchTerm] = useState("");

  // Age helper
  const getAge = (dobString?: string) => {
    if (!dobString) return "";
    const dob = new Date(dobString);
    const diff = Date.now() - dob.getTime();
    const ageDate = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  };

  // Change department (Admin only)
  const handleDeptChange = (deptKey: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("department", deptKey);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  // Filtered Queue
  const filteredQueue = initialQueue.filter(item => {
    const pName = `${item.patient?.first_name || ""} ${item.patient?.last_name || ""}`.toLowerCase();
    const qNum = (item.triage_notes?.queue_number || "").toLowerCase();
    const matchesSearch = pName.includes(searchTerm.toLowerCase()) || qNum.includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  // Group historical rows by patient_id and created_at (since database rows are flat test results)
  const groupHistoryIntoReports = (records: HistoryItem[]) => {
    const groups: { [key: string]: {
      id: string;
      patient: { id: string; first_name: string; last_name: string } | null;
      recorder: { id: string; full_name: string } | null;
      test_type: string;
      created_at: string;
      notes: string | null;
      parameters: {
        test_name: string;
        test_value: string;
        unit: string | null;
        reference_range_min: number | null;
        reference_range_max: number | null;
        is_flagged: boolean;
      }[];
      hasFlagged: boolean;
    }} = {};

    records.forEach(rec => {
      // Grouping key is patient_id + created_at timestamp
      const timeKey = `${rec.patient_id}_${rec.created_at}`;
      if (!groups[timeKey]) {
        groups[timeKey] = {
          id: rec.id, // Use one of the IDs as reference
          patient: rec.patient,
          recorder: rec.recorder,
          test_type: rec.test_type,
          created_at: rec.created_at,
          notes: rec.notes,
          parameters: [],
          hasFlagged: false
        };
      }
      
      groups[timeKey].parameters.push({
        test_name: rec.test_name,
        test_value: rec.test_value,
        unit: rec.unit,
        reference_range_min: rec.reference_range_min,
        reference_range_max: rec.reference_range_max,
        is_flagged: rec.is_flagged
      });

      if (rec.is_flagged) {
        groups[timeKey].hasFlagged = true;
      }
    });

    return Object.values(groups);
  };

  const groupedReports = groupHistoryIntoReports(initialHistory);

  // Filtered History Reports
  const filteredReports = groupedReports.filter(report => {
    const pName = `${report.patient?.first_name || ""} ${report.patient?.last_name || ""}`.toLowerCase();
    const testType = report.test_type.toLowerCase();
    const matchesSearch = pName.includes(searchTerm.toLowerCase()) || testType.includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400">
              Department Portal
            </span>
            {isPending && <Clock className="h-4 w-4 text-slate-400 animate-spin" />}
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white mt-1">
            {DEPARTMENTS[activeDept as keyof typeof DEPARTMENTS]?.label || activeDept} Department
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage patient queues, enter clinical findings, and audit department records.
          </p>
        </div>

        {/* Admin Department Switcher */}
        {userRole === "admin" && (
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 p-1.5 rounded-lg border border-slate-200/60 dark:border-slate-800">
            <span className="text-xs font-medium text-slate-500 px-2">Dept:</span>
            <select
              value={activeDept}
              onChange={(e) => handleDeptChange(e.target.value)}
              className="bg-transparent text-sm font-semibold focus:outline-none text-slate-800 dark:text-slate-100 pr-4 cursor-pointer"
            >
              <option value="laboratory">Laboratory</option>
              <option value="imaging">Imaging (X-Ray)</option>
              <option value="ultrasound">Ultrasound</option>
              <option value="ecg">ECG</option>
            </select>
          </div>
        )}
      </div>

      {/* Tabs & Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        {/* Navigation Tabs */}
        <div className="flex space-x-1 bg-slate-100/80 dark:bg-slate-900 p-1 rounded-xl w-full md:w-auto">
          <button
            onClick={() => { setActiveTab("queue"); setSearchTerm(""); }}
            className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all flex-1 md:flex-none ${
              activeTab === "queue"
                ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-sm"
                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <Users className="h-4 w-4" />
            Daily Queue ({initialQueue.length})
          </button>
          <button
            onClick={() => { setActiveTab("history"); setSearchTerm(""); }}
            className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all flex-1 md:flex-none ${
              activeTab === "history"
                ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-sm"
                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <History className="h-4 w-4" />
            Records History
          </button>
        </div>

        {/* Toolbar controls */}
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto items-stretch sm:items-center">
          {/* Search bar */}
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder={activeTab === "queue" ? "Search patient or queue..." : "Search patient or test..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 w-full text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
            />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === "queue" ? (
        // --- Daily Queue Dashboard ---
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Waiting List (2 spans) */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>Active Waiting List</span>
              <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {filteredQueue.length}
              </span>
            </h2>

            {filteredQueue.length === 0 ? (
              <div className="p-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900">
                <Users className="h-10 w-10 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">No patients queued</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Today&apos;s queue is empty or matches no filters.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredQueue.map((item) => {
                  const p = item.patient;
                  const queueNum = item.triage_notes?.queue_number || "GEN-000";
                  const vitals = item.triage_notes?.vitals;
                  const notes = item.triage_notes?.notes;

                  return (
                    <div 
                      key={item.id} 
                      className={`flex flex-col justify-between p-5 border border-slate-200/70 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 transition-all ${
                        item.status === "in_progress" ? "ring-2 ring-purple-500/30 border-purple-200" : ""
                      }`}
                    >
                      {/* Top Row: Queue # & Status */}
                      <div className="flex items-center justify-between">
                        <span className="text-base font-extrabold text-teal-600 dark:text-teal-400 tracking-wider">
                          {queueNum}
                        </span>
                        <div className="flex items-center gap-2">
                          {item.status === "in_progress" && (
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                              Entering
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Patient Basic Info */}
                      <div className="mt-3">
                        <h3 className="font-bold text-slate-950 dark:text-white text-base">
                          {p?.first_name} {p?.last_name}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {p?.gender ? p.gender.charAt(0).toUpperCase() + p.gender.slice(1) : "N/A"} • {getAge(p?.date_of_birth)} yrs old
                        </p>
                      </div>

                      {/* Vitals Summary */}
                      {vitals && (
                        <div className="mt-3 grid grid-cols-3 gap-2 bg-slate-50 dark:bg-slate-950 p-2 rounded-xl border border-slate-100 dark:border-slate-800 text-center">
                          <div>
                            <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 block uppercase">BP</span>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{vitals.blood_pressure || "—"}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 block uppercase">Temp</span>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                              {vitals.temperature_c ? `${vitals.temperature_c}°C` : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 block uppercase">Weight</span>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                              {vitals.weight_kg ? `${vitals.weight_kg}kg` : "—"}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Triage Notes */}
                      {notes && (
                        <p className="text-xs bg-slate-50/50 dark:bg-slate-950/30 p-2.5 rounded-xl border border-dashed border-slate-200/50 dark:border-slate-800 text-slate-600 dark:text-slate-400 mt-3 italic line-clamp-2">
                          &quot;{notes}&quot;
                        </p>
                      )}

                      {/* Action Button */}
                      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                        <Link
                          href={`/department/records/entry/${item.patient_id}?department=${activeDept}`}
                          className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-xl bg-teal-600 hover:bg-teal-700 dark:bg-teal-600 dark:hover:bg-teal-500 text-white shadow-sm hover:shadow-md transition-all"
                        >
                          {item.status === "in_progress" ? "Edit Results" : "Enter Results"}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Queue Statistics Sidebar (1 span) */}
          <div className="space-y-6">
            <div className="bg-slate-50 dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/50 dark:border-slate-800 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Department Overview
              </h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-white dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400 dark:text-slate-500 block">Waiting</span>
                  <span className="text-2xl font-black text-slate-900 dark:text-white mt-1 block">
                    {initialQueue.filter(q => q.status === "waiting").length}
                  </span>
                </div>
                <div className="p-4 bg-white dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400 dark:text-slate-500 block">In Progress</span>
                  <span className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1 block">
                    {initialQueue.filter(q => q.status === "in_progress").length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        // --- Records History Log ---
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>Historical Clinical Reports</span>
            <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {filteredReports.length} reports
            </span>
          </h2>

          {filteredReports.length === 0 ? (
            <div className="p-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900">
              <FileText className="h-10 w-10 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">No records found</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                No matching historical clinical records available.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredReports.map((report) => {
                const dateFormatted = format(new Date(report.created_at), "yyyy-MM-dd HH:mm");
                const p = report.patient;
                const rec = report.recorder;

                return (
                  <div 
                    key={report.id} 
                    className="p-5 border border-slate-200/80 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 shadow-sm"
                  >
                    {/* Header: Patient name, Test type, Flag badge, Date */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div>
                        <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                          {dateFormatted} • Entered by {rec?.full_name || "Unknown"}
                        </span>
                        <h3 className="font-extrabold text-slate-900 dark:text-white text-lg mt-0.5">
                          {p?.first_name} {p?.last_name}
                        </h3>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 text-xs font-extrabold uppercase rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                          {report.test_type}
                        </span>
                        {report.hasFlagged ? (
                          <span className="flex items-center gap-1 px-2.5 py-1 text-xs font-extrabold uppercase rounded-lg bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/50">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Flagged
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2.5 py-1 text-xs font-extrabold uppercase rounded-lg bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/20 dark:text-green-400 dark:border-green-900/50">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Normal
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Parameters grid */}
                    <div className="mt-4">
                      <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                        Test Parameters
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {report.parameters.map((param, index) => {
                          const isNumeric = param.reference_range_min !== null || param.reference_range_max !== null;
                          
                          return (
                            <div 
                              key={index} 
                              className={`p-3 rounded-xl border transition-all ${
                                param.is_flagged 
                                  ? "bg-red-50/50 border-red-200/80 dark:bg-red-950/10 dark:border-red-900/40" 
                                  : "bg-slate-50/50 border-slate-100 dark:bg-slate-950/30 dark:border-slate-800"
                              }`}
                            >
                              <div className="flex justify-between items-start">
                                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                  {param.test_name}
                                </span>
                                {param.is_flagged && (
                                  <span className="text-[10px] font-black uppercase text-red-600 dark:text-red-400">
                                    Flagged
                                  </span>
                                )}
                              </div>
                              <div className="flex items-baseline gap-1 mt-1">
                                <span className={`text-base font-black ${param.is_flagged ? "text-red-700 dark:text-red-400" : "text-slate-800 dark:text-slate-200"}`}>
                                  {param.test_value}
                                </span>
                                {param.unit && (
                                  <span className="text-xs text-slate-400 dark:text-slate-500 font-semibold">
                                    {param.unit}
                                  </span>
                                )}
                              </div>
                              {isNumeric && (
                                <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-1">
                                  Ref: {param.reference_range_min ?? "—"} to {param.reference_range_max ?? "—"}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Report Notes */}
                    {report.notes && (
                      <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                          Technician Notes
                        </span>
                        <p className="text-sm text-slate-700 dark:text-slate-300 mt-1 whitespace-pre-wrap">
                          {report.notes}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
