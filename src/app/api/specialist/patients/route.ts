// IMPORTANT: This route queries Supabase PostgreSQL directly. No LLM is involved. See SO-C.

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { fetchPatientRecordStats } from "@/lib/specialist-record-stats";

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
  const supabase = await createClient();

  // Rule 1 check: calling getUser() as the literal first line
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("UNAUTHORIZED: Session not found", 401);
  }

  try {
    await requirePermission("specialist.patients");

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

    // 2. Record count, flagged count and latest date per patient, grouped in
    // the database (#263).
    const { stats, error: recordsError } = await fetchPatientRecordStats(
      supabase,
      patients.map((p) => p.id),
      { testType: departmentFilter, from: startDateFilter, to: endDateFilter },
    );

    if (recordsError) {
      throw recordsError;
    }

    const results = patients
      .map((patient) => {
        const patientStats = stats.get(patient.id);

        if ((departmentFilter || startDateFilter || endDateFilter) && !patientStats) {
          // If filtering by records and none matched, exclude this patient from search results
          return null;
        }

        return {
          ...patient,
          patient_code: `PT-${patient.id.substring(0, 8).toUpperCase()}`,
          total_records: patientStats?.total_records ?? 0,
          flagged_count: patientStats?.flagged_count ?? 0,
          last_test_date: patientStats?.last_test_date ?? null,
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
    return handleRouteError(error, "Failed to fetch patients for analytics");
  }
}
