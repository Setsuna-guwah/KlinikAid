import { createClient } from "@/lib/supabase/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
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
    await requirePermission("system_logs.read");
  } catch {
    return errorResponse("Forbidden: Access denied.", 403);
  }

  try {
    const { searchParams } = new URL(request.url);
    const eventType = searchParams.get("eventType");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const userId = searchParams.get("userId");
    const download = searchParams.get("download") === "true";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    // Build the query
    let query = supabase
      .from("system_logs")
      .select(`
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
      `, { count: "exact" });

    // Apply filters
    if (eventType) {
      query = query.eq("event_type", eventType);
    }
    if (userId) {
      query = query.eq("user_id", userId);
    }
    if (startDate) {
      query = query.gte("created_at", startDate);
    }
    if (endDate) {
      query = query.lte("created_at", endDate);
    }

    // Sort by timestamp descending
    query = query.order("created_at", { ascending: false });

    let finalData = [];
    let count = 0;
    let truncated = false;

    if (download) {
      // Fetch up to 10,000 records for export
      const limitVal = 10000;
      query = query.range(0, limitVal - 1);
      const { data, count: totalCount, error: queryError } = await query;
      if (queryError) throw queryError;
      
      finalData = data || [];
      count = totalCount || 0;
      if (finalData.length >= limitVal) {
        truncated = true;
      }

      // Log mutation event for export (Standing Rule #5)
      const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
      await logEvent(
        supabase,
        user.id,
        SYSTEM_EVENT_TYPES.EXPORT_SYSTEM_LOGS,
        `Exported system logs as CSV. Filters: ${JSON.stringify({ eventType, startDate, endDate, userId })}`,
        ipAddress,
        { filters: { eventType, startDate, endDate, userId } }
      );
    } else {
      // Normal paginated request
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);
      const { data, count: totalCount, error: queryError } = await query;
      if (queryError) throw queryError;

      finalData = data || [];
      count = totalCount || 0;
    }

    return successResponse({
      logs: finalData,
      total: count,
      page,
      truncated,
    });
  } catch (err) {
    console.error("System logs GET error:", err);
    const message = err instanceof Error ? err.message : "Failed to fetch system logs.";
    return errorResponse(message, 500);
  }
}
