import React from "react";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import SpecialistAnalyticsClient from "@/components/SpecialistAnalyticsClient";
import DataLoadError from "@/components/DataLoadError";
import { classifyRead } from "@/lib/read-outcome";

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
  await requirePermission("specialist.analytics");

  const supabase = createClient();
  const { patientId } = params;

  // 1. Fetch patient details from specialist_patients
  const patientLookup = classifyRead(
    await supabase.from("specialist_patients").select("*").eq("id", patientId).single()
  );

  // This page already withheld its metrics and records queries rather than
  // rendering an empty chart. The patient lookup above them still collapsed both
  // outcomes into notFound(), so a failed read showed a 404 -- which reads as
  // "this patient was archived or deleted" and makes the specialist skip a
  // patient who is still there. Only a confirmed zero-row match may claim 404.
  if (patientLookup.kind === "failed") {
    console.error("Error fetching specialist patient for analytics:", patientLookup.error);
    return (
      <div className="space-y-6">
        <DataLoadError
          what="this patient"
          error={patientLookup.error}
          retryHref={`/specialist/patients/${patientId}/analytics`}
        />
      </div>
    );
  }

  if (patientLookup.kind === "absent") {
    notFound();
  }

  const patient = patientLookup.data;

  // 2. Fetch distinct metrics (test names) recorded for this patient from specialist_records
  const metricsRead = classifyRead(
    await supabase
      .from("specialist_records")
      .select("test_name")
      .eq("specialist_patient_id", patientId)
  );

  // 3. Fetch initial chronological records for the first metric (if available)
  let initialRecords: RecordData[] = [];
  let recordsErrorForView: unknown = null;

  const distinctMetrics =
    metricsRead.kind === "ok"
      ? Array.from(new Set((metricsRead.data ?? []).map((r) => r.test_name).filter(Boolean)))
      : [];

  if (metricsRead.kind === "ok" && distinctMetrics.length > 0) {
    const recordsRead = classifyRead(
      await supabase
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
        .order("created_at", { ascending: true })
    );

    if (recordsRead.kind === "failed") {
      console.error("Error fetching initial records for first metric:", recordsRead.error);
      recordsErrorForView = recordsRead.error;
    } else if (recordsRead.kind === "ok") {
      initialRecords = (recordsRead.data ?? []).map((r) => {
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

  // A failed metrics query yields an empty metric list, which the client renders
  // as "No records found for this metric" -- asserting that this patient has no
  // results when the results were simply unreachable. Withhold the view.
  if (metricsRead.kind === "failed") {
    return (
      <div className="space-y-6">
        <DataLoadError
          what={`analytics for ${patient.first_name} ${patient.last_name}`}
          error={metricsRead.error}
          retryHref={`/specialist/patients/${patientId}/analytics`}
        />
      </div>
    );
  }

  // A failed records query yields an empty chart, which reads as "no results
  // recorded" rather than "could not load". Same reasoning: withhold the view.
  if (recordsErrorForView) {
    return (
      <div className="space-y-6">
        <DataLoadError
          what={`results for ${patient.first_name} ${patient.last_name}`}
          error={recordsErrorForView}
          retryHref={`/specialist/patients/${patientId}/analytics`}
        />
      </div>
    );
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
