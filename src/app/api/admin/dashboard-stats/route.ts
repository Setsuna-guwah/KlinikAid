import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 1. Authorize Admin
    await requirePermission("profiles.manage");
    const supabase = createClient();

    // 2. Calculate Philippine start of today (UTC+8)
    const now = new Date();
    const phTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    phTime.setUTCHours(0, 0, 0, 0);
    const startOfToday = new Date(phTime.getTime() - 8 * 60 * 60 * 1000).toISOString();

    // 3. Run queries in parallel
    const [
      todayPatientsResult,
      pendingDocsResult,
      activeStaffResult,
      todayChatbotQueriesResult,
      recentLogsResult,
      departmentBreakdownResult
    ] = await Promise.all([
      // Count today's patients in queue
      supabase
        .from("patient_queue")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfToday),

      // Count pending documents
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),

      // Count active staff profiles
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .neq("role", "patient")
        .eq("is_active", true),

      // Count today's chatbot queries
      supabase
        .from("chatbot_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfToday),

      // Last 10 system logs with profiles
      supabase
        .from("system_logs")
        .select(`
          id,
          user_id,
          event_type,
          description,
          ip_address,
          metadata,
          created_at,
          profiles:user_id (
            full_name,
            role
          )
        `)
        .order("created_at", { ascending: false })
        .limit(10),

      // Department breakdown for today's queue
      supabase
        .from("patient_queue")
        .select("department")
        .gte("created_at", startOfToday)
    ]);

    // Handle potential query errors
    if (todayPatientsResult.error) throw todayPatientsResult.error;
    if (pendingDocsResult.error) throw pendingDocsResult.error;
    if (activeStaffResult.error) throw activeStaffResult.error;
    if (todayChatbotQueriesResult.error) throw todayChatbotQueriesResult.error;
    if (recentLogsResult.error) throw recentLogsResult.error;
    if (departmentBreakdownResult.error) throw departmentBreakdownResult.error;

    // Group department breakdown
    const deptCounts: Record<string, number> = {
      laboratory: 0,
      imaging: 0,
      ultrasound: 0,
      ecg: 0
    };

    departmentBreakdownResult.data.forEach((item) => {
      if (item.department && deptCounts[item.department] !== undefined) {
        deptCounts[item.department]++;
      }
    });

    const departmentBreakdown = Object.entries(deptCounts).map(([dept, count]) => ({
      department: dept,
      count
    }));

    return successResponse({
      todayPatients: todayPatientsResult.count || 0,
      pendingDocs: pendingDocsResult.count || 0,
      activeStaff: activeStaffResult.count || 0,
      todayChatbotQueries: todayChatbotQueriesResult.count || 0,
      recentLogs: recentLogsResult.data || [],
      departmentBreakdown
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse("Failed to fetch dashboard metrics", 500, message);
  }
}
