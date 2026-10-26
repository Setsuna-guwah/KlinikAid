import { createClient } from "@/lib/supabase/server";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { requirePermission } from "@/lib/auth/helpers";
import {
  MAX_EXPORT_ROWS,
  parseSystemLogQuery,
  type SystemLogQuery,
} from "@/lib/logs/system-log-query";
import {
  LOG_COLUMNS,
  filteredSystemLogQuery,
  readSystemLogPage,
} from "@/lib/logs/system-log-read";

export const dynamic = "force-dynamic";

type FilteredQuery = ReturnType<typeof filteredSystemLogQuery>;

export async function GET(request: Request) {
  // 1. Authenticate session & check role (Standing Rule #1 & #2)
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return errorResponse("Unauthorized: Please sign in.", 401);
  }

  try {
    await requirePermission("system_logs.read");

    const parsed = parseSystemLogQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return errorResponse(parsed.error, 400);
    }
    const q = parsed.query;

    const baseQuery = (columns: string, head = false) =>
      filteredSystemLogQuery(supabase, q, columns, { head });

    if (q.download) {
      return await exportLogs(q, baseQuery, async (exported, total) => {
        // Log mutation event for export (Standing Rule #5)
        const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0] || null;
        const filters = {
          eventType: q.eventType,
          startDate: q.startDate,
          endDate: q.endDate,
          userId: q.userId,
          search: q.search,
        };
        await logEvent(
          supabase,
          user.id,
          SYSTEM_EVENT_TYPES.EXPORT_SYSTEM_LOGS,
          `Exported ${exported} of ${total} system log rows as CSV. Filters: ${JSON.stringify(filters)}`,
          ipAddress,
          { filters, exported, total }
        );
      });
    }

    // Normal paginated request
    const page = await readSystemLogPage(supabase, q);

    return successResponse({
      logs: page.logs,
      total: page.total,
      page: q.page,
      limit: q.limit,
      truncated: false,
    });
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to fetch system logs.");
  }
}

/**
 * Collects every matching row up to MAX_EXPORT_ROWS.
 *
 * A single `range(0, 9999)` was capped by PostgREST's max-rows (1,000) without
 * any error, and `truncated` was only set at 10,000 rows -- so a 4,238-row trail
 * exported as 1,000 rows with no warning (#64). Rows are now read in chunks,
 * advancing by however many the server actually returned, so the result does
 * not depend on what max-rows is set to.
 *
 * The export is pinned to the rows that existed when it started (`id <=` the
 * highest id seen then). New events -- including this export's own audit row --
 * sort to the top and would otherwise shift every later offset, duplicating rows
 * across chunk boundaries.
 */
async function exportLogs(
  q: SystemLogQuery,
  baseQuery: (columns: string, head?: boolean) => FilteredQuery,
  recordExport: (exported: number, total: number) => Promise<void>
) {
  const CHUNK = 1000;

  const { data: newest, error: newestError } = await baseQuery("id")
    .order("id", { ascending: false })
    .limit(1);
  if (newestError) throw newestError;

  // `columns` is a runtime string, so supabase-js cannot infer the row shape.
  const ceiling = (newest as unknown as { id: number }[] | null)?.[0]?.id;
  const logs: unknown[] = [];
  let total = 0;

  if (ceiling !== undefined) {
    while (logs.length < MAX_EXPORT_ROWS) {
      const from = logs.length;
      const to = Math.min(from + CHUNK, MAX_EXPORT_ROWS) - 1;
      const { data, count, error } = await baseQuery(LOG_COLUMNS)
        .lte("id", ceiling)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
      if (error) throw error;

      total = count ?? total;
      if (!data || data.length === 0) break;
      logs.push(...data);
      if (logs.length >= total) break;
    }
  }

  await recordExport(logs.length, total);

  return successResponse({
    logs,
    total,
    exported: logs.length,
    page: 1,
    truncated: logs.length < total,
  });
}
