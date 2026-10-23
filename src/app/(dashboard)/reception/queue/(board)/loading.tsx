import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function ReceptionQueueLoading() {
  const columns = ["Pending", "Approved", "Rejected"];
  
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header Skeleton */}
      <div className="space-y-2">
        <div className="h-9 w-48 bg-slate-200 dark:bg-slate-800 rounded-md" />
        <div className="h-4 w-72 bg-slate-100 dark:bg-slate-900 rounded-md" />
      </div>

      {/* Kanban Board Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[calc(100vh-220px)] min-h-[500px]">
        {columns.map((col, idx) => (
          <div 
            key={idx} 
            className="flex flex-col h-full bg-slate-50/50 dark:bg-slate-900/35 border border-slate-200/60 dark:border-slate-800/80 rounded-xl p-3 space-y-3"
          >
            {/* Header info */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-200/50 dark:border-slate-800/50">
              <div className="h-5 w-24 bg-slate-200 dark:bg-slate-800 rounded-md" />
              <div className="h-5 w-5 bg-slate-200 dark:bg-slate-800 rounded-full" />
            </div>

            {/* Skeleton Cards */}
            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {[1, 2, 3].map((cardIdx) => (
                <Card 
                  key={cardIdx} 
                  className="border border-slate-200/85 dark:border-slate-800/70 shadow-sm"
                >
                  <CardHeader className="p-3 pb-2 space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="h-4 w-28 bg-slate-200 dark:bg-slate-800 rounded-md" />
                      <div className="h-4 w-12 bg-slate-200 dark:bg-slate-800 rounded-md" />
                    </div>
                    <div className="h-3 w-20 bg-slate-100 dark:bg-slate-900 rounded-md" />
                  </CardHeader>
                  <CardContent className="p-3 pt-0 space-y-2">
                    <div className="h-3 w-16 bg-slate-100 dark:bg-slate-900 rounded-md" />
                    <div className="h-8 w-full bg-slate-100 dark:bg-slate-900 rounded-md" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
