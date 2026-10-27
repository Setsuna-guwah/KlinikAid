import React, { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import SpecialistAnalyticsClient from "@/components/SpecialistAnalyticsClient";
import SpecialistAnalyticsSkeleton from "@/components/SpecialistAnalyticsSkeleton";
import DataLoadError from "@/components/DataLoadError";
import { classifyRead, hitRowCap } from "@/lib/read-outcome";

/**
 * The most rows one request can return. PostgREST caps every response at the
 * project's `max_rows`, which is 1000 here (verified against the live API), so
 * asking for exactly that is asking for "as many as this view can ever see".
 * A full page is then indistinguishable from a cut one, which is why the read
 * below reports `complete: false` at the cap instead of charting a guess.
 */
const PATIENT_RECORDS_LIMIT = 1000;

export const dynamic = "force-dynamic";

interface PatientAnalyticsPageProps {
  params: Promise<{
    patientId: string;
  }>;
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

export default async function PatientAnalyticsPage(props: PatientAnalyticsPageProps) {
  const params = await props.params;
  // Guard access: only admin and medical_specialist roles
  await requirePermission("specialist.analytics");

  const supabase = await createClient();
  const { patientId } = params;

  // The results read starts now, beside the patient lookup rather than after it.
  // Both are needed for the view and neither depends on the other's answer.
  const recordsRead = readPatientRecords(supabase, patientId);

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
          kind="record"
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

  // The existence check above has to finish before the first byte streams:
  // once a Suspense boundary commits the shell it also commits the 200
  // status, and notFound() can no longer turn it into a 404 (issue #213).
  // The reads below make no not-found claim, so they stream behind the
  // same skeleton this page streamed behind before.
  return (
    <Suspense fallback={<SpecialistAnalyticsSkeleton />}>
      <SpecialistAnalyticsBody
        patientId={patient.id}
        patientName={`${patient.first_name} ${patient.last_name}`}
        dob={patient.date_of_birth}
        gender={patient.gender}
        recordsRead={recordsRead}
      />
    </Suspense>
  );
}

/**
 * Every result this patient has, oldest first, in one query. The metric list and
 * the first metric's series both come from these rows, so the page needs one
 * round trip for them rather than a metric query followed by a records query.
 *
 * Called without awaiting, so the request is already in flight when the caller
 * reaches its own await.
 *
 * The read is explicitly bounded, and reports whether the bound was reached.
 * Without a limit the response is cut at the deployment's row cap anyway (see
 * PATIENT_RECORDS_LIMIT), and both things derived from these rows -- the metric
 * list and the first series -- would then be computed from the oldest 1000
 * results as if they were all of them: a metric recorded after that point is
 * simply absent from the dropdown, with nothing on screen saying so.
 */
async function readPatientRecords(supabase: Awaited<ReturnType<typeof createClient>>, patientId: string) {
  const rows = await supabase
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
    .order("created_at", { ascending: true })
    .limit(PATIENT_RECORDS_LIMIT);

  const read = classifyRead(rows);

  return {
    read,
    // A failed read is not a complete one either, but it already has its own
    // branch; this flag is about a read that succeeded and was cut short.
    complete: read.kind !== "ok" || !hitRowCap(read.data?.length ?? 0, PATIENT_RECORDS_LIMIT),
  };
}

interface SpecialistAnalyticsBodyProps {
  patientId: string;
  patientName: string;
  dob: string;
  gender: string;
  recordsRead: ReturnType<typeof readPatientRecords>;
}

async function SpecialistAnalyticsBody({
  patientId,
  patientName,
  dob,
  gender,
  recordsRead: pendingRecordsRead,
}: SpecialistAnalyticsBodyProps) {
  const { read: recordsRead, complete: recordsComplete } = await pendingRecordsRead;

  // A failed read yields an empty metric list, which the client renders as "No
  // records found for this metric" -- asserting that this patient has no results
  // when the results were simply unreachable. Withhold the view.
  if (recordsRead.kind === "failed") {
    console.error("Error fetching patient results for analytics:", recordsRead.error);
    return (
      <div className="space-y-6">
        <DataLoadError
          what={`analytics for ${patientName}`}
          error={recordsRead.error}
          retryHref={`/specialist/patients/${patientId}/analytics`}
        />
      </div>
    );
  }

  // A read that succeeded but came back full may have been cut at the row cap
  // (readPatientRecords). Both things derived from these rows would then be
  // subtly wrong in the same silent way: a metric first recorded after the cut
  // is missing from the dropdown, and the first series is the oldest of however
  // many results fitted. Say that instead of charting a partial history.
  if (!recordsComplete) {
    console.error(
      `Patient ${patientId} has at least ${PATIENT_RECORDS_LIMIT} results: too many for the analytics view to read at once`
    );
    return (
      <div className="space-y-6">
        <DataLoadError
          what={`analytics for ${patientName}`}
          kind="page"
          error={{
            message: `the results read returned a full page of ${PATIENT_RECORDS_LIMIT}, so more may exist`,
          }}
          description="This patient has more results than this view can load at once, so the metric list and the chart would both come from an incomplete set. Nothing is missing from the record itself; this view cannot show a history this long yet."
          retryHref={`/specialist/patients/${patientId}/analytics`}
        />
      </div>
    );
  }

  // Only a list query reaches here, so zero rows is "ok" with an empty list.
  const rows = recordsRead.kind === "ok" ? recordsRead.data ?? [] : [];
  const distinctMetrics = Array.from(new Set(rows.map((r) => r.test_name).filter(Boolean)));

  const initialRecords: RecordData[] = rows
    .filter((r) => r.test_name === distinctMetrics[0])
    .map((r) => {
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

  return (
    <SpecialistAnalyticsClient
      patientId={patientId}
      patientName={patientName}
      patientCode={`PT-${patientId.substring(0, 8).toUpperCase()}`}
      dob={dob}
      gender={gender}
      initialMetrics={distinctMetrics}
      initialRecords={initialRecords}
    />
  );
}
