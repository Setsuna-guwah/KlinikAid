import { createClient } from "@/lib/supabase/server";
import type { SystemLogQuery, SystemLogRow } from "@/lib/logs/system-log-query";
import { containsPattern } from "@/lib/logs/system-log-query";

/**
 * The one database read behind a page of system events. The System Logs page
 * (server-rendered first page) and `GET /api/admin/logs/system` (every later
 * page, search and filter) both call it, so they cannot disagree about what a
 * page contains.
 *
 * Server-only: it takes the request-scoped Supabase client, so the RLS and the
 * caller's own session still decide what rows are visible.
 */

export const LOG_COLUMNS = `
  id,
  user_id,
  event_type,
  description,
  ip_address,
  metadata,
  created_at,
  profiles (
    full_name,
    role
  )
`;

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// PostgREST answers 416 / PGRST103 when the requested offset is past the last
// row. That is an empty page, not a server fault.
const RANGE_NOT_SATISFIABLE = "PGRST103";

export function filteredSystemLogQuery(
  supabase: SupabaseServerClient,
  q: SystemLogQuery,
  columns: string,
  { head = false, exactCount = true }: { head?: boolean; exactCount?: boolean } = {}
) {
  let query = supabase
    .from("system_logs")
    .select(columns, { count: exactCount ? "exact" : undefined, head });

  if (q.eventType) query = query.eq("event_type", q.eventType);
  if (q.userId) query = query.eq("user_id", q.userId);
  if (q.startDate) query = query.gte("created_at", q.startDate);
  if (q.endDate) query = query.lte("created_at", q.endDate);
  if (q.search) query = query.ilike("description", containsPattern(q.search));
  return query;
}

/**
 * One page of system events, newest first.
 *
 * `total` is counted exactly unless the caller already knows it for these
 * filters (`knownTotal`): then the count scan is skipped and the known value is
 * reported back. Only paging uses that; a new filter or search always counts.
 *
 * Throws the Supabase error on failure. Callers decide how to present it.
 */
export async function readSystemLogPage(
  supabase: SupabaseServerClient,
  q: SystemLogQuery
): Promise<{ logs: SystemLogRow[]; total: number }> {
  const from = (q.page - 1) * q.limit;
  const to = from + q.limit - 1;
  const exactCount = q.knownTotal === null;

  const { data, count, error } = await filteredSystemLogQuery(supabase, q, LOG_COLUMNS, { exactCount })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (error?.code === RANGE_NOT_SATISFIABLE) {
    // Past the end: still report the true total so the pager stays honest.
    if (q.knownTotal !== null) return { logs: [], total: q.knownTotal };
    const { count: total, error: countError } = await filteredSystemLogQuery(supabase, q, "id", {
      head: true,
    });
    if (countError) throw countError;
    return { logs: [], total: total ?? 0 };
  }
  if (error) throw error;

  return {
    logs: (data ?? []) as unknown as SystemLogRow[],
    total: q.knownTotal ?? count ?? 0,
  };
}
