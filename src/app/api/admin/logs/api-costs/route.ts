import { createClient } from "@/lib/supabase/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { toZonedTime, format } from "date-fns-tz";
import { requirePermission } from "@/lib/auth/helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  // 1. Authenticate session & check role (Standing Rule #1 & #2)
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return errorResponse("Unauthorized: Please sign in.", 401);
  }

  try {
    await requirePermission("system_logs.read");
  } catch {
    return errorResponse("Forbidden: Access denied.", 403);
  }

  try {
    // 2. Calculate PHT 30-day window start timestamp (Revision D)
    const nowPHT = toZonedTime(new Date(), "Asia/Manila");
    const todayStr = format(nowPHT, "yyyy-MM-dd", { timeZone: "Asia/Manila" });
    const midnightTodayPHT = new Date(`${todayStr}T00:00:00+08:00`);
    const thirtyDaysAgoUTC = new Date(
      midnightTodayPHT.getTime() - 29 * 24 * 60 * 60 * 1000
    ).toISOString();

    // 3. Query daily token usage from RPC function
    const { data, error: rpcError } = await supabase.rpc("get_daily_token_usage", {
      start_date: thirtyDaysAgoUTC,
    });

    if (rpcError) {
      throw rpcError;
    }

    return successResponse(data || []);
  } catch (err) {
    console.error("API costs GET error:", err);
    const message = err instanceof Error ? err.message : "Failed to fetch daily token usage costs.";
    return errorResponse(message, 500);
  }
}
