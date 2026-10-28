import { createClient } from "@/lib/supabase/server";
import type { SystemLogQuery, SystemLogRow } from "@/lib/logs/system-log-query";
import { containsPattern, rpcContainsPattern } from "@/lib/logs/system-log-query";

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

// PostgREST reports PGRST202 when the called function does not exist: the
// database has not had migration 46 applied yet. The search then takes the
// table query below, so the app deploys before the migration and the search
// keeps working (slower) in either order.
const SEARCH_FUNCTION_MISSING = "PGRST202";

/** The RPC's log row: the table's columns with the profile flattened. */
interface SearchedLogRow {
  id: number | string;
  user_id: string | null;
  event_type: string;
  description: string;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  profile_full_name: string | null;
  profile_role: string | null;
}

export interface SystemLogPage {
  logs: SystemLogRow[];
  total: number;
}

function isSearchedPayload(value: unknown): value is { total: number; logs: SearchedLogRow[] } {
  if (typeof value !== "object" || value === null) return false;
  const { total, logs } = value as { total?: unknown; logs?: unknown };
  return typeof total === "number" && Array.isArray(logs);
}

function toSystemLogRow(row: SearchedLogRow): SystemLogRow {
  return {
    id: String(row.id),
    user_id: row.user_id,
    event_type: row.event_type,
    description: row.description,
    ip_address: row.ip_address,
    metadata: row.metadata,
    created_at: row.created_at,
    // The function only joins a profile the caller's own policies would
    // show, so a missing profile stays null exactly as the embed does.
    profiles:
      row.profile_full_name === null
        ? null
        : { full_name: row.profile_full_name, role: row.profile_role ?? "" },
  };
}

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
 * One page of searched events through `search_system_logs` (migration 46,
 * extended with `p_known_total` in migration 48).
 *
 * The RPC exists because the planner will not use the trigram index for
 * ILIKE under the table's RLS policy: ILIKE is not leakproof, so Postgres
 * never pushes it below the security quals into an index condition, and the
 * search stayed a sequential scan over a growing table (#234). The function
 * checks the same `system_logs.read` permission the policy checks and keeps
 * the profiles embed's visibility, but runs as its owner, where the index is
 * usable.
 *
 * `p_known_total` skips the count on later pages of the same search, the
 * contract the table path already has for `knownTotal`. While migration 48
 * is not applied yet, no installed function takes that argument, so the call
 * answers PGRST202 and one retry without it reuses migration 46's function,
 * which counts. A PGRST202 on that retry means migration 46 is missing too,
 * and the caller falls back to the table query. Every other failure is
 * thrown: a failed search must never be read as an empty trail.
 */
async function readSearchedLogPage(
  supabase: SupabaseServerClient,
  q: SystemLogQuery
): Promise<SystemLogPage | null> {
  const rpcArgs = (withKnownTotal: boolean) => ({
    p_event_type: q.eventType,
    p_user_id: q.userId,
    p_start_date: q.startDate,
    p_end_date: q.endDate,
    // The function applies the pattern as-is. rpcContainsPattern sends the
    // effective pattern the table path would evaluate for the same term,
    // PostgREST's `*` -> `%` translation included, so both paths match the
    // same rows.
    p_search: rpcContainsPattern(q.search ?? ""),
    p_from: (q.page - 1) * q.limit,
    p_limit: q.limit,
    ...(withKnownTotal ? { p_known_total: q.knownTotal } : {}),
  });

  let { data, error } = await supabase.rpc("search_system_logs", rpcArgs(q.knownTotal !== null));

  if (error?.code === SEARCH_FUNCTION_MISSING && q.knownTotal !== null) {
    ({ data, error } = await supabase.rpc("search_system_logs", rpcArgs(false)));
  }

  if (error?.code === SEARCH_FUNCTION_MISSING) return null;
  if (error) throw error;
  if (!isSearchedPayload(data)) {
    throw new Error("search_system_logs returned an unexpected payload shape.");
  }

  return { logs: data.logs.map(toSystemLogRow), total: data.total };
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
): Promise<SystemLogPage> {
  if (q.search) {
    const searched = await readSearchedLogPage(supabase, q);
    if (searched !== null) return searched;
    // Not installed yet: the table query below still answers, just slower.
  }

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
