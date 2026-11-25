import React from "react";
import { requirePermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import SpecialistPatientsClient from "@/components/SpecialistPatientsClient";
import DataLoadError from "@/components/DataLoadError";
import { fetchPatientRecordStats, type PatientRecordStats } from "@/lib/specialist-record-stats";

export const dynamic = "force-dynamic";

/**
 * Maximum rows rendered before the roster tells the specialist it is truncated.
 * Mirrors `PATIENT_PAGE_CAP` in `/api/specialist/patients/route.ts`.
 */
const ROSTER_PAGE_CAP = 100;

export default async function SpecialistPatientsPage() {
  // Enforce access: only admin and specialist
  await requirePermission("specialist.patients");

  const supabase = await createClient();

  // 1. Fetch patients (prevent unbounded scan)
  const { data: patients, error: patientsError } = await supabase
    .from("specialist_patients")
    .select("*")
    .order("last_name", { ascending: true })
    .limit(ROSTER_PAGE_CAP);

  if (patientsError) {
    console.error("Error fetching patients list:", patientsError);
  }

  // How many patients exist in total. The list above is capped, so without this
  // the roster reports "of 100 patients" as though that were the whole
  // directory -- and any patient past the cap is invisible to their own
  // specialist, permanently and silently.
  const { count: rosterTotal, error: rosterTotalError } = await supabase
    .from("specialist_patients")
    .select("id", { count: "exact", head: true });

  if (rosterTotalError) {
    console.error("Error fetching roster total:", rosterTotalError);
  }

  // 2. Record count, flagged count and latest date per patient (#263).
  const { stats, error: recordsError } =
    patients && patients.length > 0
      ? await fetchPatientRecordStats(supabase, patients.map((p) => p.id))
      : { stats: new Map<string, PatientRecordStats>(), error: null };

  if (recordsError) {
    console.error("Error fetching record stats for patients:", recordsError);
  }

  // Every row in this roster is built from those stats: total_records, flagged_count
  // and last_test_date. If that query failed, each patient would render as "0
  // records, 0 flagged" -- an empty diagnostic history and no out-of-range
  // results, asserted as fact. A roster of confident wrong counts is more
  // dangerous than no roster, so the whole view is withheld rather than shown
  // with fabricated zeroes.
  const loadError = patientsError ?? recordsError ?? rosterTotalError;

  const formattedPatients = (patients || []).map((patient) => {
    const patientStats = stats.get(patient.id);

    return {
      id: patient.id,
      first_name: patient.first_name,
      last_name: patient.last_name,
      date_of_birth: patient.date_of_birth,
      gender: patient.gender,
      contact_number: patient.contact_number,
      email: patient.email,
      address: patient.address,
      patient_code: `PT-${patient.id.substring(0, 8).toUpperCase()}`,
      total_records: patientStats?.total_records ?? 0,
      flagged_count: patientStats?.flagged_count ?? 0,
      last_test_date: patientStats?.last_test_date ?? null
    };
  });

  return (
    <>
      {loadError ? (
        <DataLoadError
          what="your patient roster"
          error={loadError}
          retryHref="/specialist/patients"
        />
      ) : null}
      {loadError ? null : (
        <SpecialistPatientsClient
          initialPatients={formattedPatients}
          rosterTotal={rosterTotal ?? null}
          rosterLimit={ROSTER_PAGE_CAP}
        />
      )}
    </>
  );
}
