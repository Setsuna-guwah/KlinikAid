import { createClient } from "@/lib/supabase/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { toZonedTime, format } from "date-fns-tz";
import { requirePermission } from "@/lib/auth/helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // 1. Authenticate session & check role (Standing Rule #1 & #2)
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return errorResponse("Unauthorized: Please sign in.", 401);
  }

  try {
    await requirePermission("chatbot_logs.read");
  } catch {
    return errorResponse("Forbidden: Access denied.", 403);
  }

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const includeStats = searchParams.get("includeStats") === "true";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    let finalLogs = [];
    let count = 0;
    let truncated = false;

    if (sessionId) {
      // Fetch entire thread for session ID chronologically (cap 200)
      const maxCount = 200;
      const { data, error: threadError } = await supabase
        .from("chatbot_logs")
        .select(`
          id,
          user_id,
          session_id,
          user_message,
          bot_response,
          tokens_used,
          feedback,
          created_at,
          profiles (
            full_name,
            role
          )
        `)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
        .range(0, maxCount); // Fetch up to 201 rows to check truncation

      if (threadError) throw threadError;

      const threadData = data || [];
      if (threadData.length > maxCount) {
        truncated = true;
        finalLogs = threadData.slice(0, maxCount);
      } else {
        finalLogs = threadData;
      }
      count = finalLogs.length;
    } else {
      // Normal paginated list of sessions descending
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      const { data, count: totalCount, error: queryError } = await supabase
        .from("chatbot_logs")
        .select(`
          id,
          user_id,
          session_id,
          user_message,
          bot_response,
          tokens_used,
          feedback,
          created_at,
          profiles (
            full_name,
            role
          )
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (queryError) throw queryError;

      finalLogs = data || [];
      count = totalCount || 0;
    }

    // Conditionally compute today's stats (Revision F)
    let todayStats = null;
    if (includeStats) {
      const nowPHT = toZonedTime(new Date(), "Asia/Manila");
      const todayStr = format(nowPHT, "yyyy-MM-dd", { timeZone: "Asia/Manila" });
      const startOfTodayUTC = new Date(`${todayStr}T00:00:00+08:00`).toISOString();

      const { data: statsData, error: statsError } = await supabase
        .from("chatbot_logs")
        .select("tokens_used")
        .gte("created_at", startOfTodayUTC);

      if (statsError) throw statsError;

      const todayCount = statsData ? statsData.length : 0;
      const todayTokens = statsData ? statsData.reduce((acc, row) => acc + (row.tokens_used || 0), 0) : 0;

      todayStats = {
        queries: todayCount,
        tokens: todayTokens,
      };
    }

    return successResponse({
      logs: finalLogs,
      total: count,
      truncated,
      ...(todayStats && { todayStats }),
    });
  } catch (err) {
    console.error("Chatbot logs GET error:", err);
    const message = err instanceof Error ? err.message : "Failed to fetch chatbot logs.";
    return errorResponse(message, 500);
  }
}
