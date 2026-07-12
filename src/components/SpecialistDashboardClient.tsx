"use client";

import React from "react";
import Link from "next/link";
import { 
  Users, 
  AlertTriangle, 
  Layers, 
  ArrowRight, 
  Activity, 
  Clock, 
  AlertCircle
} from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SpecialistDashboardClientProps {
  stats: {
    totalPatients: number;
    flaggedThisWeek: number;
    departmentsCovered: number;
  };
  recentFlagged: Array<{
    id: string;
    test_name: string;
    test_value: string;
    unit: string | null;
    reference_range_min: number | null;
    reference_range_max: number | null;
    created_at: string;
    patient: {
      id: string;
      first_name: string;
      last_name: string;
    } | null;
  }>;
  recentPatients: Array<{
    id: string;
    first_name: string;
    last_name: string;
    last_activity: string;
  }>;
}

export default function SpecialistDashboardClient({
  stats,
  recentFlagged,
  recentPatients
}: SpecialistDashboardClientProps) {

  const formatPhTime = (utcString: string) => {
    try {
      const date = new Date(utcString);
      return formatInTimeZone(date, "Asia/Manila", "MMM dd, yyyy hh:mm a");
    } catch {
      return utcString;
    }
  };

  const getPatientCode = (id: string) => {
    return `PT-${id.substring(0, 8).toUpperCase()}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 dark:from-white dark:via-slate-200 dark:to-indigo-300 bg-clip-text text-transparent">
          Specialist Dashboard
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Review patient records, analyze trends, and audit critical parameters.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* KPI: Total Patients */}
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm transition hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Clinic Patients
            </span>
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg text-indigo-600 dark:text-indigo-400">
              <Users className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {stats.totalPatients}
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Registered patient directory records
            </p>
          </CardContent>
        </Card>

        {/* KPI: Flagged This Week */}
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm transition hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Flagged Results (7 Days)
            </span>
            <div className="p-2 bg-rose-50 dark:bg-rose-950/40 rounded-lg text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {stats.flaggedThisWeek}
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Out-of-bounds parameters needing review
            </p>
          </CardContent>
        </Card>

        {/* KPI: Departments Covered */}
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm transition hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Modalities
            </span>
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg text-emerald-600 dark:text-emerald-400">
              <Layers className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {stats.departmentsCovered}
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Active diagnostic departments in records
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid split */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Table of 10 most recent flagged results */}
        <Card className="lg:col-span-2 border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertCircle className="h-4.5 w-4.5 text-rose-500" />
              Critical Flagged Results
            </CardTitle>
            <CardDescription className="text-xs">
              Ten most recent out-of-range records. Click row to analyze.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 font-semibold border-y border-slate-100 dark:border-slate-800">
                    <th className="p-3 pl-4">Patient</th>
                    <th className="p-3">Test</th>
                    <th className="p-3 text-center">Value</th>
                    <th className="p-3">Reference Range</th>
                    <th className="p-3">Date</th>
                    <th className="p-3 pr-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                  {recentFlagged.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400 dark:text-slate-500">
                        No critical flagged results found.
                      </td>
                    </tr>
                  ) : (
                    recentFlagged.map((record) => (
                      <tr key={record.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition">
                        <td className="p-3 pl-4 font-semibold text-slate-800 dark:text-slate-200">
                          {record.patient ? `${record.patient.first_name} ${record.patient.last_name}` : "Unknown"}
                          <div className="text-[10px] font-normal text-slate-400 dark:text-slate-500 mt-0.5">
                            {record.patient ? getPatientCode(record.patient.id) : ""}
                          </div>
                        </td>
                        <td className="p-3 font-medium text-slate-700 dark:text-slate-300">
                          {record.test_name}
                        </td>
                        <td className="p-3 text-center">
                          <Badge variant="destructive" className="font-semibold px-2 py-0.5 text-[10px]">
                            {record.test_value} {record.unit}
                          </Badge>
                        </td>
                        <td className="p-3 text-slate-500 font-mono text-[10px]">
                          {record.reference_range_min !== null && record.reference_range_max !== null ? (
                            `${record.reference_range_min} - ${record.reference_range_max}`
                          ) : (
                            "No limit"
                          )}
                        </td>
                        <td className="p-3 text-slate-400 font-mono text-[10px]">
                          {formatPhTime(record.created_at)}
                        </td>
                        <td className="p-3 pr-4 text-right">
                          {record.patient?.id ? (
                            <Link 
                              href={`/specialist/patients/${record.patient.id}/analytics`}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
                            >
                              Analyze
                              <ArrowRight className="h-3 w-3" />
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* 5 most recently updated patients */}
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Clock className="h-4.5 w-4.5 text-indigo-500" />
              Recently Updated Patients
            </CardTitle>
            <CardDescription className="text-xs">
              Patients with newly recorded diagnostics
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentPatients.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-6">
                No patients with records found.
              </p>
            ) : (
              recentPatients.map((p) => (
                <div 
                  key={p.id} 
                  className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800 rounded-lg hover:border-slate-200 dark:hover:border-slate-800 transition bg-slate-50/20 dark:bg-slate-900/5"
                >
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {p.first_name} {p.last_name}
                    </p>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                      <span className="font-mono">{getPatientCode(p.id)}</span>
                      <span>•</span>
                      <span>Active: {formatPhTime(p.last_activity)}</span>
                    </div>
                  </div>
                  <Link 
                    href={`/specialist/patients/${p.id}/analytics`}
                    className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-400 transition"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ))
            )}
            <div className="pt-2">
              <Link 
                href="/specialist/patients"
                className="w-full py-2 border border-dashed border-indigo-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 font-semibold rounded-lg text-xs flex items-center justify-center gap-2 hover:bg-indigo-50/50 dark:hover:bg-slate-900/40 transition"
              >
                Search All Patients
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Static Disclaimer */}
      <div className="p-4 rounded-xl border border-amber-100 dark:border-amber-900/30 bg-amber-50/30 dark:bg-amber-950/10 text-amber-800 dark:text-amber-300 text-xs leading-relaxed flex gap-2">
        <Activity className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">No AI Diagnostics Inference:</span> This dashboard provides clinical descriptive analytics only. No machine learning diagnostics or automated diagnostic suggestions are applied to this patient data (SO-C Compliance).
        </div>
      </div>
    </div>
  );
}
