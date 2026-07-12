"use client";

import React, { useState } from "react";
import { 
  FileText, 
  AlertCircle,
  TrendingUp,
  Search,
  SlidersHorizontal
} from "lucide-react";
import { formatPhTime } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DepartmentRecord } from "@/types";

interface PatientResultsClientProps {
  initialRecords: DepartmentRecord[];
}

export default function PatientResultsClient({ initialRecords }: PatientResultsClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDept, setSelectedDept] = useState<string>("all");

  // Filter records based on query and selected department
  const filteredRecords = initialRecords.filter((rec) => {
    const matchesSearch = 
      rec.test_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rec.test_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (rec.notes && rec.notes.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesDept = selectedDept === "all" || rec.department === selectedDept;

    return matchesSearch && matchesDept;
  });

  // Group records by date (using formatPhTime to group by day)
  const groupRecordsByDate = (records: DepartmentRecord[]) => {
    const groups: Record<string, DepartmentRecord[]> = {};
    records.forEach((rec) => {
      const dateKey = formatPhTime(rec.created_at);
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(rec);
    });
    return groups;
  };

  const groupedRecords = groupRecordsByDate(filteredRecords);
  const dateKeys = Object.keys(groupedRecords);

  const hasNumericBaseline = (rec: DepartmentRecord) =>
    rec.reference_range_min !== null && rec.reference_range_max !== null;

  const getDepartmentBadge = (dept: string) => {
    switch (dept) {
      case "laboratory":
        return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-semibold">Laboratory</Badge>;
      case "imaging":
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-semibold">Imaging (X-Ray)</Badge>;
      case "ultrasound":
        return <Badge className="bg-teal-500 hover:bg-teal-600 text-white text-[10px] font-semibold">Ultrasound</Badge>;
      default:
        return <Badge className="bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-semibold">ECG</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">My Results</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
            View released medical parameters and laboratory sheets securely
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="grid gap-4 sm:grid-cols-3 bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <div className="sm:col-span-2 relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
          <Input
            placeholder="Search parameters or comments..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-slate-50/50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 focus:bg-white dark:focus:bg-slate-950 transition-colors"
          />
        </div>
        <div className="relative">
          <SlidersHorizontal className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="w-full pl-9 pr-8 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-sm bg-slate-50/50 dark:bg-slate-900/50 text-slate-800 dark:text-slate-200 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat"
          >
            <option value="all">All Departments</option>
            <option value="laboratory">Laboratory</option>
            <option value="imaging">Imaging (X-Ray)</option>
            <option value="ultrasound">Ultrasound</option>
            <option value="ecg">ECG</option>
          </select>
        </div>
      </div>

      {/* Main Results Container */}
      <Card className="border border-slate-200/80 dark:border-slate-800 shadow-md">
        <CardHeader className="bg-slate-50/55 dark:bg-slate-900/30 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400">
              <FileText className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold">Released Laboratory Sheets</CardTitle>
              <CardDescription className="text-xs">
                Diagnostic measurements and staff records sorted chronologically
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {initialRecords.length === 0 ? (
            <div className="text-center py-16 text-slate-400 dark:text-slate-500 flex flex-col items-center justify-center space-y-2">
              <FileText className="h-12 w-12 text-slate-400 stroke-1 animate-pulse" />
              <p className="text-sm font-semibold">No medical records found</p>
              <p className="text-xs max-w-xs leading-relaxed">
                Your medical releases and lab sheets will appear here once officially logged.
              </p>
            </div>
          ) : dateKeys.length === 0 ? (
            <div className="text-center py-16 text-slate-400 dark:text-slate-500 text-xs">
              No results matches your filter parameters.
            </div>
          ) : (
            <div className="divide-y divide-slate-150 dark:divide-slate-850">
              {dateKeys.map((dateKey) => (
                <div key={dateKey} className="p-6 space-y-4">
                  {/* Date Heading */}
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-900 pb-2">
                    <span className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-emerald-500" />
                      Results Released: {dateKey}
                    </span>
                    <Badge variant="outline" className="text-[10px] font-semibold text-slate-400 dark:border-slate-800">
                      {groupedRecords[dateKey].length} Parameters
                    </Badge>
                  </div>

                  {/* Results table for this date */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 font-semibold border-y border-slate-100 dark:border-slate-800">
                          <th className="p-3 pl-4">Parameter Name</th>
                          <th className="p-3">Department</th>
                          <th className="p-3 text-center">Observed Value</th>
                          <th className="p-3">Reference Range</th>
                          <th className="p-3">Status Flag</th>
                          <th className="p-3 pr-4">Clinical Annotations</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                        {groupedRecords[dateKey].map((rec) => {
                          const isNumericResult = hasNumericBaseline(rec);

                          return (
                          <tr key={rec.id} className="hover:bg-slate-50/20 dark:hover:bg-slate-900/5 transition">
                            {/* Parameter Name */}
                            <td className="p-3 pl-4 font-bold text-slate-800 dark:text-slate-200">
                              <div className="flex flex-col">
                                <span>{rec.test_name}</span>
                                <span className="text-[10px] text-slate-400 font-medium capitalize mt-0.5">{rec.test_type}</span>
                              </div>
                            </td>

                            {/* Department */}
                            <td className="p-3">
                              {getDepartmentBadge(rec.department)}
                            </td>

                            {/* Observed Value */}
                            <td className="p-3 text-center">
                              <span className={`text-sm font-extrabold font-mono ${
                                rec.is_flagged 
                                  ? "text-red-600 dark:text-red-400" 
                                  : "text-slate-800 dark:text-slate-200"
                              }`}>
                                {rec.test_value} {rec.unit || ""}
                              </span>
                            </td>

                            {/* Reference Range */}
                            <td className="p-3 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                              {isNumericResult ? (
                                `${rec.reference_range_min} - ${rec.reference_range_max} ${rec.unit || ""}`
                              ) : (
                                "No baseline"
                              )}
                            </td>

                            {/* Status Flag */}
                            <td className="p-3">
                              {!isNumericResult ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200/60 uppercase tracking-wider dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800">
                                  N/A
                                </span>
                              ) : rec.is_flagged ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200/55 uppercase tracking-wider dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30">
                                  Out of Range
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/35 uppercase tracking-wider dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/10">
                                  Normal
                                </span>
                              )}
                            </td>

                            {/* Annotations / Notes */}
                            <td className="p-3 pr-4 text-slate-500 dark:text-slate-400 italic max-w-xs truncate" title={rec.notes || ""}>
                              {rec.notes || "--"}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prominent NO AI Disclaimer */}
      <div className="p-4 rounded-xl border border-amber-100 dark:border-amber-900/30 bg-amber-50/20 dark:bg-amber-950/10 text-amber-800 dark:text-amber-300 text-xs leading-relaxed flex gap-2.5 shadow-sm">
        <AlertCircle className="h-4.5 w-4.5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold uppercase tracking-wider text-[10px] bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded mr-1.5 text-amber-900 dark:text-amber-200">
            SO-C Disclaimer
          </span>
          <span className="font-bold">No AI Diagnostic Inference Applied:</span> This results registry compiles released laboratory parameter values directly from clinic database storage. No automated machine diagnostics, diagnosis suggestions, interpretation models, or clinical prognoses are applied (Specific Objective C compliant).
        </div>
      </div>
    </div>
  );
}
