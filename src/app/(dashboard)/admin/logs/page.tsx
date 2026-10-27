import React from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import LogsDashboardClient from "./LogsDashboardClient";
import { timed } from "@/lib/perf/timing";
import {
  SYSTEM_LOG_PAGE_SIZE,
  type InitialSystemLogs,
  type SystemLogQuery,
} from "@/lib/logs/system-log-query";
import { readSystemLogPage } from "@/lib/logs/system-log-read";

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

  const supabase = await createClient();

  // 2. The first page of the default tab and the user filter dropdown are read
  // together, so the first view needs no browser fetch and costs one round
  // trip, not two. Profiles excludes the patient role for ease of audit.
  const firstPage: SystemLogQuery = {
    page: 1,
    limit: SYSTEM_LOG_PAGE_SIZE,
    eventType: null,
    userId: null,
    startDate: null,
    endDate: null,
    search: null,
    download: false,
    knownTotal: null,
  };
  const [profilesResult, systemResult] = await Promise.all([
    timed("page.logs.profiles", () =>
      supabase
        .from("profiles")
        .select("id, full_name, role")
        .order("full_name", { ascending: true })
    ),
    timed("page.logs.system", () =>
      readSystemLogPage(supabase, firstPage).then(
        (page) => ({ kind: "ok" as const, ...page }),
        (error: unknown) => ({ kind: "failed" as const, error })
      )
    ),
  ]);
  const { data: profilesData, error: profilesError } = profilesResult;

  if (profilesError) {
    console.error("Failed to fetch profiles for filter dropdown:", profilesError);
  }

  // 3. Load FREE_TIER_TOKEN_LIMIT env var (Revision G & Standing Rule #11)
  const freeTierTokenLimitRaw = process.env.FREE_TIER_TOKEN_LIMIT || "10000000";
  const freeTierTokenLimit = parseInt(freeTierTokenLimitRaw, 10) || 10000000;

  const profiles = profilesData || [];

  // The first System Events page, or the reason it could not be read. A failed
  // read is passed down as a failure so the table says so, instead of rendering
  // an empty trail.
  const initialSystem: InitialSystemLogs =
    systemResult.kind === "ok"
      ? { kind: "ok", logs: systemResult.logs, total: systemResult.total }
      : { kind: "failed", message: "Failed to fetch system logs." };
  if (systemResult.kind === "failed") {
    console.error("Failed to fetch the first system log page:", systemResult.error);
  }

  // The profiles fetch only populates the user filter dropdown, and its error
  // was logged but never surfaced. On failure the dropdown silently renders
  // empty, so an admin auditing activity by actor sees no filter options and may
  // conclude the log has no actors. Passed down rather than blocking the page,
  // since the log itself loads independently.
  const profilesLoadError = profilesError ? { message: profilesError.message } : null;

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
          profilesError={profilesLoadError}
          freeTierTokenLimit={freeTierTokenLimit}
          initialSystem={initialSystem}
        />
      </div>
    </div>
  );
}
