import React from "react";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import SpecialistAnalyticsClient from "@/components/SpecialistAnalyticsClient";

export const dynamic = "force-dynamic";

interface PatientAnalyticsPageProps {
  params: {
    patientId: string;
  };
}

interface RecordData {
  id: string;
  test_name: string;
  test_value: string;
  unit: string | null;
  reference_range_min: number | null;
  reference_range_max: number | null;
  is_flagged: boolean;
  notes: string | null;
  created_at: string;
  result_date: string;
  recorder: {
    id: string;
    full_name: string;
  } | null;
  department: string;
}

export default async function PatientAnalyticsPage({
  params
}: PatientAnalyticsPageProps) {
  // Guard access: only admin and medical_specialist roles
  await requireRole(["admin", "medical_specialist"]);

  const supabase = createClient();
  const { patientId } = params;

  // 1. Fetch patient details from specialist_patients
  const { data: patient, error: patientError } = await supabase
    .from("specialist_patients")
    .select("*")
    .eq("id", patientId)
    .single();

  if (patientError || !patient) {
    notFound();
  }

  // 2. Fetch distinct metrics (test names) recorded for this patient from specialist_records
  const { data: metricsData, error: metricsError } = await supabase
    .from("specialist_records")
    .select("test_name")
    .eq("specialist_patient_id", patientId);

  if (metricsError) {
    console.error("Error fetching patient metrics list:", metricsError);
  }

  const distinctMetrics = Array.from(
    new Set((metricsData || []).map((r) => r.test_name).filter(Boolean))
  );

  // 3. Fetch initial chronological records for the first metric (if available)
  let initialRecords: RecordData[] = [];
  if (distinctMetrics.length > 0) {
    const { data: records, error: recordsError } = await supabase
      .from("specialist_records")
      .select(`
        id,
        test_name,
        test_value,
        unit,
        reference_range_min,
        reference_range_max,
        is_flagged,
        notes,
        created_at,
        test_type,
        recorder:specialist_id (
          id,
          full_name
        )
      `)
      .eq("specialist_patient_id", patientId)
      .eq("test_name", distinctMetrics[0])
      .order("created_at", { ascending: true });

    if (recordsError) {
      console.error("Error fetching initial records for first metric:", recordsError);
    } else {
      initialRecords = (records || []).map((r) => {
        const rec = r as unknown as RecordData;
        const rawRecorder = r.recorder;
        const recorderObj = Array.isArray(rawRecorder)
          ? rawRecorder[0]
          : (rawRecorder as unknown as { id: string; full_name: string } | null);

        return {
          id: rec.id,
          test_name: rec.test_name,
          test_value: rec.test_value,
          unit: rec.unit,
          reference_range_min: rec.reference_range_min,
          reference_range_max: rec.reference_range_max,
          is_flagged: rec.is_flagged,
          notes: rec.notes,
          created_at: rec.created_at,
          result_date: rec.created_at,
          recorder: recorderObj ? { id: recorderObj.id, full_name: recorderObj.full_name } : null,
          department: r.test_type
        };
      });
    }
  }

  return (
    <SpecialistAnalyticsClient
      patientId={patient.id}
      patientName={`${patient.first_name} ${patient.last_name}`}
      patientCode={`PT-${patient.id.substring(0, 8).toUpperCase()}`}
      dob={patient.date_of_birth}
      gender={patient.gender}
      initialMetrics={distinctMetrics}
      initialRecords={initialRecords}
    />
  );
}
