import React from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import LogsDashboardClient from "./LogsDashboardClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "System Oversight & Logs | KlinikAid",
  description: "Monitor clinic system audit logs, chatbot tokens, and API consumption costs.",
};

export default async function AdminLogsPage() {
  // 1. Authenticate and enforce Admin role server-side (Standing Rule #1 & #2)
  const { user, profile } = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (!profile || !(await hasPermission(user.id, "system_logs.read"))) {
    redirect("/403");
  }

  const supabase = createClient();

  // 2. Fetch profiles for user filter dropdown (excluding patient role for ease of audit)
  const { data: profilesData, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .order("full_name", { ascending: true });

  if (profilesError) {
    console.error("Failed to fetch profiles for filter dropdown:", profilesError);
  }

  // 3. Load FREE_TIER_TOKEN_LIMIT env var (Revision G & Standing Rule #11)
  const freeTierTokenLimitRaw = process.env.FREE_TIER_TOKEN_LIMIT || "10000000";
  const freeTierTokenLimit = parseInt(freeTierTokenLimitRaw, 10) || 10000000;

  const profiles = profilesData || [];

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
            System Oversight & Logs
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            Audit clinic system events, monitor chatbot conversations, and analyze API token cost performance.
          </p>
        </div>

        <LogsDashboardClient 
          profiles={profiles} 
          freeTierTokenLimit={freeTierTokenLimit} 
        />
      </div>
    </div>
  );
}
