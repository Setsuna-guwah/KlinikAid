import React from "react";
import { requirePermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import SpecialistPatientsClient from "@/components/SpecialistPatientsClient";

export const dynamic = "force-dynamic";

export default async function SpecialistPatientsPage() {
  // Enforce access: only admin and specialist
  await requirePermission("specialist.patients");

  const supabase = createClient();

  // 1. Fetch patients (prevent unbounded scan)
  const { data: patients, error: patientsError } = await supabase
    .from("specialist_patients")
    .select("*")
    .order("last_name", { ascending: true })
    .limit(100);

  if (patientsError) {
    console.error("Error fetching patients list:", patientsError);
  }

  // 2. Fetch records for these patients in a separate query to prevent massive nested scans (capped at 50000)
  let records: { specialist_patient_id: string; is_flagged: boolean; created_at: string }[] = [];
  if (patients && patients.length > 0) {
    const { data: recordsData, error: recordsError } = await supabase
      .from("specialist_records")
      .select("specialist_patient_id, is_flagged, created_at")
      .in("specialist_patient_id", patients.map((p) => p.id))
      .limit(50000);
    
    if (recordsError) {
      console.error("Error fetching records for patients:", recordsError);
    } else {
      records = recordsData || [];
    }
  }

  const formattedPatients = (patients || []).map((patient) => {
    const patientRecords = records.filter((r) => r.specialist_patient_id === patient.id);
    const totalRecords = patientRecords.length;
    const flaggedCount = patientRecords.filter((r) => r.is_flagged).length;
    
    let lastTestDate: string | null = null;
    if (patientRecords.length > 0) {
      lastTestDate = patientRecords.reduce(
        (max: string, r) => (r.created_at > max ? r.created_at : max),
        patientRecords[0].created_at
      );
    }

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
      total_records: totalRecords,
      flagged_count: flaggedCount,
      last_test_date: lastTestDate
    };
  });

  return (
    <SpecialistPatientsClient initialPatients={formattedPatients} />
  );
}
