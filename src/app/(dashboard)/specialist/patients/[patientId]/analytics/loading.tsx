import React from "react";
import { Card, CardContent } from "@/components/ui/card";

export default function SpecialistAnalyticsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header Loading State */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <div className="h-5 w-32 bg-slate-200 dark:bg-slate-800 rounded-md" />
          <div className="h-9 w-64 bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-4 w-96 bg-slate-200 dark:bg-slate-800 rounded-md" />
        </div>
        <div className="h-10 w-28 bg-slate-200 dark:bg-slate-800 rounded-lg shrink-0" />
      </div>

      {/* Patient Demographic Card Skeleton */}
      <Card className="border border-slate-200/80 dark:border-slate-800">
        <CardContent className="p-6 grid gap-6 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
              <div className="h-6 w-36 bg-slate-200 dark:bg-slate-800 rounded-md" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Main Analytics Selector + Chart Skeleton */}
      <Card className="border border-slate-200/80 dark:border-slate-800">
        <CardContent className="p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="space-y-2">
              <div className="h-5 w-40 bg-slate-200 dark:bg-slate-800 rounded-md" />
              <div className="h-4 w-60 bg-slate-200 dark:bg-slate-800 rounded-md" />
            </div>
            <div className="h-10 w-48 bg-slate-200 dark:bg-slate-800 rounded-lg" />
          </div>

          {/* Dummy Chart Area */}
          <div className="h-[350px] w-full bg-slate-100/50 dark:bg-slate-900/30 rounded-xl flex items-end justify-between p-6">
            {[30, 45, 60, 40, 80, 50, 75, 90, 65, 85, 70, 95].map((h, i) => (
              <div
                key={i}
                style={{ height: `${h}%` }}
                className="w-[6%] bg-slate-200/70 dark:bg-slate-800/60 rounded-t-md transition-all duration-300"
              />
            ))}
          </div>

          {/* Disclaimer Skeleton */}
          <div className="h-14 w-full bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-100 dark:border-slate-800" />
        </CardContent>
      </Card>

      {/* Records Table Skeleton */}
      <Card className="border border-slate-200/80 dark:border-slate-800">
        <CardContent className="p-0">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800">
            <div className="h-5 w-48 bg-slate-200 dark:bg-slate-800 rounded-md" />
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-850">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-9 w-9 bg-slate-200 dark:bg-slate-800 rounded-full" />
                  <div className="space-y-1">
                    <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
                    <div className="h-3 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
                  </div>
                </div>
                <div className="h-6 w-16 bg-slate-200 dark:bg-slate-800 rounded-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
