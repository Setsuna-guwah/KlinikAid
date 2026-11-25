import type { SupabaseClient } from "@supabase/supabase-js";

export interface PatientRecordStats {
  total_records: number;
  flagged_count: number;
  last_test_date: string | null;
}

interface StatsRow extends PatientRecordStats {
  specialist_patient_id: string;
}

/**
 * Record count, flagged count and latest record date for each listed patient,
 * grouped in the database by `specialist_patient_record_stats` (migration 49,
 * #263) instead of downloading every record. RLS still decides which records
 * count. Patients with no matching record are absent from the map.
 */
export async function fetchPatientRecordStats(
  supabase: SupabaseClient,
  patientIds: string[],
  filters: { testType?: string; from?: string; to?: string } = {},
): Promise<{ stats: Map<string, PatientRecordStats>; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("specialist_patient_record_stats", {
    patient_ids: patientIds,
    p_test_type: filters.testType || null,
    p_from: filters.from || null,
    p_to: filters.to || null,
  });
  if (error) return { stats: new Map(), error };
  return {
    stats: new Map(
      ((data ?? []) as StatsRow[]).map((row) => [
        row.specialist_patient_id,
        {
          total_records: Number(row.total_records),
          flagged_count: Number(row.flagged_count),
          last_test_date: row.last_test_date,
        },
      ]),
    ),
    error: null,
  };
}
