import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = createClient();
  
  // 1. Session check - literal first operation (Rule 1)
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // 2. Role authorization (Rule 2)
    await requirePermission("documents.manage");

    // 3. Query Param Filtering
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get("status");

    // 4. Retrieve Documents with Patient & Uploader data
    let query = supabase
      .from("documents")
      .select(`
        *,
        patient:patient_id (
          id,
          first_name,
          last_name,
          date_of_birth,
          gender,
          contact_number,
          email,
          address
        ),
        uploader:uploader_id (
          id,
          full_name,
          role
        )
      `)
      .order("created_at", { ascending: false });

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data: documents, error: dbError } = await query;

    if (dbError) {
      throw dbError;
    }

    return successResponse(documents, "Documents fetched successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse("Failed to fetch documents", 500, message);
  }
}
