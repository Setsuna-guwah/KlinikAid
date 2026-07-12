"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { 
  ArrowLeft, 
  User, 
  TrendingUp,
  FileText,
  RefreshCw,
  AlertCircle
} from "lucide-react";
import { getAge, formatPhTime, formatPhTimeFull } from "@/lib/utils";
import { 
  ResponsiveContainer, 
  ComposedChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ReferenceArea, 
  ReferenceLine
} from "recharts";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHART_COLORS } from "@/lib/constants";

interface RecordData {
  id: string;
  test_name: string;
  test_value: string;
  unit: string | null;
  reference_range_min: number | null;
  reference_range_max: number | null;
  is_flagged: boolean;
  notes: string | null;
  created_at: string;
  result_date: string;
  recorder: {
    id: string;
    full_name: string;
  } | null;
  department: string;
}

interface SpecialistAnalyticsClientProps {
  patientId: string;
  patientName: string;
  patientCode: string;
  dob: string;
  gender: string;
  initialMetrics: string[];
  initialRecords: RecordData[];
}

const CustomTooltip = ({ 
  active, 
  payload 
}: { 
  active?: boolean; 
  payload?: Array<{ payload: RecordData & { numeric_value: number | null } }>; 
}) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as RecordData & { numeric_value: number | null };
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-lg shadow-lg text-xs space-y-1.5">
        <p className="font-semibold text-slate-500 dark:text-slate-400">
          {formatPhTimeFull(data.result_date)}
        </p>
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
          Value: <span className={data.is_flagged ? "text-rose-600 font-extrabold" : "text-emerald-600"}>
            {data.test_value} {data.unit}
          </span>
        </p>
        <p className="text-slate-500 dark:text-slate-400">
          Status: {data.is_flagged ? (
            <span className="text-rose-500 font-bold uppercase text-[9px] border border-rose-200 bg-rose-50/50 px-1 rounded">
              Out of Range (Flagged)
            </span>
          ) : (
            <span className="text-emerald-500 font-medium">Within Range</span>
          )}
        </p>
        {(data.reference_range_min !== null || data.reference_range_max !== null) && (
          <p className="text-slate-400 font-mono text-[10px]">
            Range limit: {data.reference_range_min !== null ? data.reference_range_min : "0"} - {data.reference_range_max !== null ? data.reference_range_max : "∞"} {data.unit}
          </p>
        )}
        {data.notes && (
          <p className="text-slate-400 dark:text-slate-400 italic mt-1 border-t border-slate-100 dark:border-slate-800 pt-1">
            Note: &ldquo;{data.notes}&rdquo;
          </p>
        )}
      </div>
    );
  }
  return null;
};

export default function SpecialistAnalyticsClient({
  patientId,
  patientName,
  patientCode,
  dob,
  gender,
  initialMetrics,
  initialRecords
}: SpecialistAnalyticsClientProps) {
  const [metrics] = useState<string[]>(initialMetrics);
  const [selectedMetric, setSelectedMetric] = useState<string>(initialMetrics[0] || "");
  const [records, setRecords] = useState<RecordData[]>(initialRecords);
  const [loading, setLoading] = useState(false);
  const isFirstMount = useRef(true);

  useEffect(() => {
    if (!selectedMetric) return;
    
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    const fetchAnalytics = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/specialist/patients/${patientId}/analytics?metric=${encodeURIComponent(selectedMetric)}`
        );
        const result = await res.json();
        if (result.success) {
          setRecords(result.data);
        }
      } catch (err) {
        console.error("Error fetching patient analytics:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [selectedMetric, patientId]);

  // Shared helper functions are imported from @/lib/utils

  const getNumericValue = (value: string) => {
    const rawVal = typeof (value as unknown) === "number"
      ? (value as unknown as number)
      : parseFloat(value);
    return Number.isNaN(rawVal) ? null : rawVal;
  };

  const hasNumericBaseline = (record: RecordData) =>
    record.reference_range_min !== null && record.reference_range_max !== null;

  // Convert test value to number for graphing
  const chartData = records.map((r) => {
    return {
      ...r,
      numeric_value: getNumericValue(r.test_value),
      formatted_date: formatPhTime(r.result_date || r.created_at)
    };
  });
  const chartableData = chartData.filter((r) => r.numeric_value !== null);
  const hasOnlyTextValues = records.length > 0 && chartableData.length === 0;

  // Fetch reference limits from first record
  const firstRec = records[0];
  const refMin = firstRec?.reference_range_min ?? null;
  const refMax = firstRec?.reference_range_max ?? null;
  const unit = firstRec?.unit || "";

  // CustomTooltip defined outside component body to optimize render performance

  return (
    <div className="space-y-6">
      {/* Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/specialist/patients"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to patient directory
          </Link>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-indigo-900 dark:from-white dark:to-indigo-300 bg-clip-text text-transparent">
            Diagnostic Analytics
          </h1>
        </div>

        {/* Metric Selector Dropdown */}
        {metrics.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Parameter:</span>
            <select
              value={selectedMetric}
              onChange={(e) => setSelectedMetric(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-sm bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 appearance-none pr-8 relative bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat"
            >
              {metrics.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Patient Profile Summary Card */}
      <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm bg-slate-50/20 dark:bg-slate-900/5">
        <CardContent className="p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 items-center">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-50 dark:bg-indigo-950/30 rounded-full text-indigo-600 dark:text-indigo-400 shrink-0">
                <User className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-semibold text-slate-400 dark:text-slate-500">Patient Name</p>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{patientName}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold text-slate-400 dark:text-slate-500">Patient Code</p>
              <p className="text-sm font-mono font-bold text-slate-800 dark:text-slate-100">{patientCode}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold text-slate-400 dark:text-slate-500">Demographics</p>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-400">
                {getAge(dob)} years old • <span className="capitalize">{gender}</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold text-slate-400 dark:text-slate-500">Birth Date</p>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-400">{formatPhTime(dob)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chart Section */}
      <Card className="border border-slate-200/80 dark:border-slate-800 shadow-md">
        <CardHeader className="pb-2 border-b border-slate-100 dark:border-slate-800 flex flex-row justify-between items-center">
          <div>
            <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <TrendingUp className="h-4.5 w-4.5 text-indigo-500" />
              Longitudinal Diagnostic Trajectory
            </CardTitle>
            <CardDescription className="text-xs">
              Chronological progress plots for parameter: <span className="font-bold text-indigo-600 dark:text-indigo-400">{selectedMetric || "None"}</span>
            </CardDescription>
          </div>
          {refMin !== null && refMax !== null && (
            <Badge variant="outline" className="font-mono text-[9px] uppercase border-slate-200 dark:border-slate-800">
              Normal limit: {refMin} - {refMax} {unit}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="pt-6">
          {loading ? (
            <div className="h-[400px] flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
              <RefreshCw className="h-5 w-5 animate-spin text-indigo-500 mr-2" />
              Refreshing database statistics...
            </div>
          ) : records.length === 0 ? (
            <div className="h-[400px] flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs border border-dashed border-slate-100 dark:border-slate-800 rounded-xl">
              No historical data recorded for metric: {selectedMetric}
            </div>
          ) : hasOnlyTextValues ? (
            <div className="h-[400px] flex flex-col items-center justify-center text-center text-slate-500 dark:text-slate-400 text-xs border border-dashed border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/40 dark:bg-slate-900/20">
              <FileText className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
              <span className="font-bold text-slate-700 dark:text-slate-300">Not chartable - text parameter</span>
              <span className="mt-1 max-w-xs leading-relaxed">
                This parameter stores narrative findings, so no numeric trend line is available.
              </span>
            </div>
          ) : (
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartableData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" className="dark:stroke-slate-900" />
                  <XAxis 
                    dataKey="formatted_date" 
                    tick={{ fontSize: 9, fill: "#94a3b8" }}
                    stroke="#cbd5e1"
                    className="dark:stroke-slate-800"
                  />
                  <YAxis 
                    tick={{ fontSize: 9, fill: "#94a3b8" }}
                    stroke="#cbd5e1"
                    className="dark:stroke-slate-800"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  
                  {/* Reference Area (Green background for normal range) */}
                  {refMin !== null && refMax !== null && (
                    <ReferenceArea 
                      y1={refMin} 
                      y2={refMax} 
                      fill={CHART_COLORS.normalBand} 
                      fillOpacity={0.07} 
                    />
                  )}

                  {/* Reference Lines (Red dashed boundary limits) */}
                  {refMax !== null && (
                    <ReferenceLine 
                      y={refMax} 
                      stroke={CHART_COLORS.flagged} 
                      strokeDasharray="4 4" 
                      label={{ value: `Max (${refMax})`, fill: CHART_COLORS.flagged, position: 'top', fontSize: 8, fontWeight: 'bold' }} 
                    />
                  )}
                  {refMin !== null && (
                    <ReferenceLine 
                      y={refMin} 
                      stroke={CHART_COLORS.flagged} 
                      strokeDasharray="4 4" 
                      label={{ value: `Min (${refMin})`, fill: CHART_COLORS.flagged, position: 'bottom', fontSize: 8, fontWeight: 'bold' }} 
                    />
                  )}

                  {/* Time Series Line with customized coloring for flagged dots */}
                  <Line
                    type="monotone"
                    dataKey="numeric_value"
                    stroke={CHART_COLORS.laboratory}
                    strokeWidth={2.5}
                    connectNulls={false}
                    dot={(dotProps) => {
                      const { cx, cy, payload } = dotProps;
                      if (cx === undefined || cy === undefined) return <g key={payload?.id || cx} />;
                      return (
                        <circle
                          key={payload.id}
                          cx={cx}
                          cy={cy}
                          r={5.5}
                          fill={payload.is_flagged ? CHART_COLORS.flagged : CHART_COLORS.laboratory}
                          stroke="#ffffff"
                          strokeWidth={1.5}
                          className="drop-shadow-sm transition cursor-pointer"
                        />
                      );
                    }}
                    activeDot={{ r: 7.5, strokeWidth: 2 }}
                    name={selectedMetric}
                  />
                </ComposedChart>
              </ResponsiveContainer>
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
          <span className="font-bold">No AI Diagnostic Inference Applied:</span> This longitudinal chart maps historical medical data points directly from SQL server storage. No automated machine diagnostics, diagnostics suggestions, or predictive algorithms are used (Specific Objective C compliant).
        </div>
      </div>

      {/* Detailed Chronological History Table */}
      <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText className="h-4.5 w-4.5 text-indigo-500" />
            Parameter History Records
          </CardTitle>
          <CardDescription className="text-xs">
            Chronological audit list of diagnostic results for metric &ldquo;{selectedMetric}&rdquo;
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 font-semibold border-y border-slate-100 dark:border-slate-800">
                  <th className="p-3 pl-4">Timestamp (UTC+8)</th>
                  <th className="p-3">Technologist</th>
                  <th className="p-3 text-center">Value</th>
                  <th className="p-3">Reference Baseline</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 pr-4">Clinical Annotations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400 dark:text-slate-500">
                      No records found for this metric.
                    </td>
                  </tr>
                ) : (
                  records.map((rec) => {
                    const isNumericResult = hasNumericBaseline(rec) && getNumericValue(rec.test_value) !== null;

                    return (
                    <tr key={rec.id} className="hover:bg-slate-50/25 dark:hover:bg-slate-900/5 transition">
                      <td className="p-3 pl-4 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                        {formatPhTimeFull(rec.result_date)}
                      </td>
                      <td className="p-3 text-slate-700 dark:text-slate-400">
                        {rec.recorder?.full_name || "Unknown Staff"}
                        <Badge variant="outline" className="ml-1.5 px-1 py-0 text-[8px] tracking-wider uppercase border-slate-200 text-slate-400">
                          {rec.department}
                        </Badge>
                      </td>
                      <td className="p-3 text-center font-bold text-slate-800 dark:text-slate-100">
                        {rec.test_value} {rec.unit}
                      </td>
                      <td className="p-3 text-slate-500 font-mono text-[10px]">
                        {rec.reference_range_min !== null && rec.reference_range_max !== null ? (
                          `${rec.reference_range_min} - ${rec.reference_range_max}`
                        ) : (
                          "--"
                        )}
                      </td>
                      <td className="p-3">
                        {!isNumericResult ? (
                          <Badge variant="outline" className="font-bold text-[9px] px-1.5 py-0.5 uppercase tracking-wider border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                            N/A
                          </Badge>
                        ) : rec.is_flagged ? (
                          <Badge variant="destructive" className="font-bold text-[9px] px-1.5 py-0.5 uppercase tracking-wider">
                            Flagged
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400 font-bold text-[9px] px-1.5 py-0.5 uppercase tracking-wider border border-emerald-100 dark:border-emerald-900/10">
                            Clear
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 pr-4 text-slate-600 dark:text-slate-400 italic max-w-xs truncate" title={rec.notes || ""}>
                        {rec.notes || "--"}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
