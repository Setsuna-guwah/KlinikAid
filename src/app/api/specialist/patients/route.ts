// IMPORTANT: This route queries Supabase PostgreSQL directly. No LLM is involved. See SO-C.

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";

/**
 * Maximum rows this endpoint will return.
 *
 * The roster is deliberately capped rather than left unbounded, but a cap that
 * is not reported is indistinguishable from a complete list. Every response
 * therefore carries the uncapped number of search matches alongside the capped
 * page, so the client can say "N match, first 100 listed" instead of implying
 * the list is everything.
 */
const PATIENT_PAGE_CAP = 100;

interface RosterPage {
  patients: Array<Record<string, unknown>>;
  /** Uncapped count of patients matching the search terms. */
  matchCount: number;
  /** True when `matchCount` exceeds what was returned. */
  truncated: boolean;
  limit: number;
}

export async function GET(request: Request) {
  const supabase = createClient();

  // Rule 1 check: calling getUser() as the literal first line
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("UNAUTHORIZED: Session not found", 401);
  }

  try {
    await requirePermission("specialist.patients");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isForbidden = message.includes("FORBIDDEN");
    return errorResponse(message, isForbidden ? 403 : 401);
  }

  try {

    // Parse filters
    const { searchParams } = new URL(request.url);
    const searchVal = searchParams.get("query")?.trim() || "";
    const departmentFilter = searchParams.get("department")?.trim() || "";
    const startDateFilter = searchParams.get("startDate")?.trim() || "";
    const endDateFilter = searchParams.get("endDate")?.trim() || "";

    // 1. Fetch patients from specialist_patients.
    //
    // `count: "exact"` (without `head`) asks for the uncapped total in the same
    // round trip as the capped page, so the response can state how many patients
    // match rather than implying the page is all of them. `head` is deliberately
    // not used: it would suppress the rows this endpoint exists to return.
    let queryBuilder = supabase.from("specialist_patients").select("*", { count: "exact" });

    if (searchVal) {
      if (searchVal.toLowerCase().startsWith("pt-")) {
        const rawPart = searchVal.substring(3).replace(/-/g, "").toLowerCase();
        if (rawPart.length > 0) {
          if (/^[0-9a-f]+$/.test(rawPart)) {
            const lowerBound = rawPart.padEnd(32, "0");
            const upperBound = rawPart.padEnd(32, "f");
            queryBuilder = queryBuilder.gte("id", lowerBound).lte("id", upperBound);
          } else {
            queryBuilder = queryBuilder.eq("id", "00000000-0000-0000-0000-000000000000");
          }
        }
      } else {
        queryBuilder = queryBuilder.or(`first_name.ilike.%${searchVal}%,last_name.ilike.%${searchVal}%`);
      }
    }

    const {
      data: patients,
      error: patientsError,
      count: matchCount,
    } = await queryBuilder.limit(PATIENT_PAGE_CAP);

    if (patientsError) {
      throw patientsError;
    }

    const totalMatches = matchCount ?? 0;

    if (!patients || patients.length === 0) {
      return successResponse<RosterPage>(
        {
          patients: [],
          matchCount: totalMatches,
          truncated: false,
          limit: PATIENT_PAGE_CAP,
        },
        "No patients found"
      );
    }

    // 2. Fetch records for these patients from specialist_records
    let recordsQuery = supabase
      .from("specialist_records")
      .select("specialist_patient_id, test_type, is_flagged, created_at")
      .in("specialist_patient_id", patients.map((p) => p.id));

    if (departmentFilter) {
      recordsQuery = recordsQuery.eq("test_type", departmentFilter);
    }
    if (startDateFilter) {
      recordsQuery = recordsQuery.gte("created_at", startDateFilter);
    }
    if (endDateFilter) {
      recordsQuery = recordsQuery.lte("created_at", endDateFilter);
    }

    const { data: records, error: recordsError } = await recordsQuery;

    if (recordsError) {
      throw recordsError;
    }

    // 3. Aggregate stats in-memory
    const results = patients
      .map((patient) => {
        const patientRecords = (records || []).filter((r) => r.specialist_patient_id === patient.id);

        if ((departmentFilter || startDateFilter || endDateFilter) && patientRecords.length === 0) {
          // If filtering by records and none matched, exclude this patient from search results
          return null;
        }

        const totalRecords = patientRecords.length;
        const flaggedCount = patientRecords.filter((r) => r.is_flagged).length;
        
        let lastTestDate: string | null = null;
        if (patientRecords.length > 0) {
          lastTestDate = patientRecords.reduce(
            (max, r) => (r.created_at > max ? r.created_at : max),
            patientRecords[0].created_at
          );
        }

        return {
          ...patient,
          patient_code: `PT-${patient.id.substring(0, 8).toUpperCase()}`,
          total_records: totalRecords,
          flagged_count: flaggedCount,
          last_test_date: lastTestDate,
        };
      })
      .filter(Boolean);

    return successResponse<RosterPage>(
      {
        patients: results as Array<Record<string, unknown>>,
        matchCount: totalMatches,
        truncated: results.length < totalMatches,
        limit: PATIENT_PAGE_CAP,
      },
      "Patients fetched successfully"
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to fetch patients for analytics:", message);
    return errorResponse("Failed to fetch patients for analytics", 500);
  }
}
