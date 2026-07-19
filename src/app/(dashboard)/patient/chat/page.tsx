import React from "react";
import { requirePermission } from "@/lib/auth/helpers";
import PatientChatClient from "./PatientChatClient";

export const dynamic = "force-dynamic";

export default async function PatientChatPage() {
  // 1. Enforce patient RBAC role authorization (Rule 2)
  await requirePermission("chat.access");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">AI Assistant</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Ask the clinic chatbot regarding rules, schedules, and clinical tests
        </p>
      </div>

      <PatientChatClient />
    </div>
  );
}
