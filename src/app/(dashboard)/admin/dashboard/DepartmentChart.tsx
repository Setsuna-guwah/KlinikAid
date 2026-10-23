"use client";

import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { DEPARTMENTS, CHART_COLORS } from "@/lib/constants";

interface ChartData {
  department: string;
  count: number;
}

export default function DepartmentChart({ data }: { data: ChartData[] }) {
  // Map internal department keys to labels and colors
  const chartData = data.map((item) => {
    const info = DEPARTMENTS[item.department as keyof typeof DEPARTMENTS];
    return {
      name: info ? info.label : item.department,
      count: item.count,
      color: item.department === "laboratory"
        ? CHART_COLORS.laboratory
        : item.department === "imaging"
        ? CHART_COLORS.xray
        : item.department === "ultrasound"
        ? CHART_COLORS.ultrasound
        : CHART_COLORS.ecg,
    };
  });


  return (
    <div className="w-full h-[300px]">
      {/* The parent is a fixed h-[300px], so the height needs no measurement.
          A numeric height makes the first render's calculated height positive,
          which suppresses Recharts' width(-1)/height(-1) warning before the
          ResizeObserver reports the real width; width stays responsive. */}
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100 dark:stroke-slate-800" />
          <XAxis 
            dataKey="name" 
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis 
            tick={{ fill: "#64748b", fontSize: 11 }}
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(255, 255, 255, 0.96)",
              border: "1px solid #e2e8f0",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
            }}
            labelStyle={{ fontWeight: "600", color: "#0f172a" }}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={45}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
