import React from "react";

export default function DashboardLoading() {
  return (
    <div className="space-y-6 w-full animate-pulse">
      {/* Page Header Skeleton */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          {/* Breadcrumb / Category placeholder */}
          <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-800" />
          {/* Page Title placeholder */}
          <div className="h-8 w-48 rounded bg-slate-300 dark:bg-slate-700" />
        </div>
        {/* Action Button placeholder */}
        <div className="h-10 w-32 rounded bg-slate-200 dark:bg-slate-800 self-start sm:self-center" />
      </div>

      {/* KPI Cards Grid Skeleton */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-4 w-20 rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-800" />
            </div>
            <div className="space-y-2">
              <div className="h-8 w-24 rounded bg-slate-300 dark:bg-slate-700" />
              <div className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-800" />
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Layout Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Large Chart/Table Card Skeleton */}
        <div className="lg:col-span-2 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <div className="h-5 w-32 rounded bg-slate-300 dark:bg-slate-700" />
              <div className="h-3 w-48 rounded bg-slate-200 dark:bg-slate-800" />
            </div>
            <div className="h-8 w-24 rounded bg-slate-200 dark:bg-slate-800" />
          </div>
          <div className="h-64 w-full rounded-lg bg-slate-100 dark:bg-slate-950 flex items-end justify-between p-4 pt-10">
            {/* Mock bar chart heights */}
            <div className="w-[12%] h-[40%] rounded-t bg-slate-200 dark:bg-slate-800" />
            <div className="w-[12%] h-[65%] rounded-t bg-slate-200 dark:bg-slate-800" />
            <div className="w-[12%] h-[45%] rounded-t bg-slate-200 dark:bg-slate-800" />
            <div className="w-[12%] h-[80%] rounded-t bg-slate-200 dark:bg-slate-800" />
            <div className="w-[12%] h-[55%] rounded-t bg-slate-200 dark:bg-slate-800" />
            <div className="w-[12%] h-[90%] rounded-t bg-slate-300 dark:bg-slate-700" />
            <div className="w-[12%] h-[70%] rounded-t bg-slate-200 dark:bg-slate-800" />
          </div>
        </div>

        {/* Side Panel List Skeleton */}
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
          <div className="space-y-1.5">
            <div className="h-5 w-28 rounded bg-slate-300 dark:bg-slate-700" />
            <div className="h-3 w-36 rounded bg-slate-200 dark:bg-slate-800" />
          </div>
          <div className="space-y-3 pt-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-50 dark:border-slate-800 last:border-0">
                <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-3/4 rounded bg-slate-300 dark:bg-slate-700" />
                  <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
