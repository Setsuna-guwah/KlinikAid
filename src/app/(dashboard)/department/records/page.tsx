import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, hasAnyPermission } from "@/lib/auth/helpers";
import DepartmentRecordsClient from "@/components/DepartmentRecordsClient";
import DataLoadError from "@/components/DataLoadError";
import { Department } from "@/types";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    department?: string;
  }>;
}

interface QueuePatient {
  id: string;
  first_name: string;
  last_name: string;
  gender: string;
  date_of_birth: string;
}

interface DbQueueItem {
  id: string;
  patient_id: string;
  department: string;
  status: string;
  priority_level: string;
  triage_notes: string | {
    queue_number?: string;
    vitals?: {
      blood_pressure?: string | null;
      weight_kg?: number | null;
      temperature_c?: number | null;
    } | null;
    notes?: string;
  } | null;
  created_at: string;
  patient: QueuePatient | null;
}

export default async function DepartmentRecordsPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const { user, profile } = await getCurrentUser();

  if (!user || !profile) {
    redirect("/login");
  }

  // 1. Enforce RBAC for department queue/records surface
  const canAccessDepartmentRecords = await hasAnyPermission(user.id, [
    "queue.manage",
    "queue.manage.own_dept",
    "records.manage",
    "records.manage.own_dept",
  ]);
  if (!canAccessDepartmentRecords) {
    redirect("/403");
  }
  const canSelectDepartmentContext = await hasAnyPermission(user.id, ["queue.manage", "records.manage"]);

  // 2. Resolve department context
  let dept = profile.department;
  if (canSelectDepartmentContext) {
    dept = ((await searchParams).department as Department) || profile.department || "laboratory";
  }

  if (!dept || !["laboratory", "imaging", "ultrasound", "ecg"].includes(dept)) {
    // If no department is set for staff, redirect or show error
    return (
      <div className="p-6 text-center">
        <h1 className="text-xl font-bold text-red-500">Access Denied</h1>
        <p className="text-slate-500 mt-2">Your profile is not assigned to a valid department.</p>
      </div>
    );
  }

  // 3. Fetch the open patient queue (waiting or in_progress), regardless of age.
  //
  // This list used to be scoped to `created_at >= start-of-PHT-today`. That made
  // it disagree with two other queries over the same table: reception's re-triage
  // guard (api/reception/triage/route.ts) has no date predicate, and the
  // completion update (api/department/records/route.ts) had the same daily filter.
  // An entry created before PHT midnight was therefore hidden here, still
  // blocking re-triage for reception, and impossible to close -- permanently
  // stuck, and still shown to the patient as "waiting" on their own dashboard.
  //
  // Invariant now: an entry blocks reception if and only if it is listed here and
  // closeable from here. Keep all three queries unfiltered by date together.
  const { data: queueData, error: queueError } = await supabase
    .from("patient_queue")
    .select(`
      id,
      patient_id,
      department,
      status,
      priority_level,
      triage_notes,
      created_at,
      patient:patient_id (
        id,
        first_name,
        last_name,
        gender,
        date_of_birth
      )
    `)
    .eq("department", dept)
    .in("status", ["waiting", "in_progress"])
    .order("created_at", { ascending: true });

  // 5. Fetch historical records
  const { data: historyData, error: historyError } = await supabase
    .from("department_records")
    .select(`
      id,
      patient_id,
      recorder_id,
      department,
      test_type,
      test_name,
      test_value,
      unit,
      reference_range_min,
      reference_range_max,
      is_flagged,
      notes,
      created_at,
      patient:patient_id (
        id,
        first_name,
        last_name
      ),
      recorder:recorder_id (
        id,
        full_name
      )
    `)
    .eq("department", dept)
    .order("created_at", { ascending: false });

  // Normalize queue and history types
  const queue = ((queueData as unknown as DbQueueItem[]) || []).map((q) => {
    let parsedNotes = null;
    if (q.triage_notes) {
      if (typeof q.triage_notes === "string") {
        try {
          parsedNotes = JSON.parse(q.triage_notes);
        } catch {
          parsedNotes = null;
        }
      } else {
        parsedNotes = q.triage_notes;
      }
    }
    return {
      id: q.id,
      patient_id: q.patient_id,
      department: q.department,
      status: q.status,
      priority_level: (q.priority_level as "routine" | "urgent" | "critical") || "routine",
      triage_notes: parsedNotes,
      created_at: q.created_at,
      patient: q.patient
    };
  });

  const history = (historyData || []).map((h) => {
    let patientObj = null;
    if (h.patient) {
      const p = h.patient as unknown as { id: string; first_name: string; last_name: string } | { id: string; first_name: string; last_name: string }[];
      if (Array.isArray(p)) {
        patientObj = p[0] ? { id: p[0].id, first_name: p[0].first_name, last_name: p[0].last_name } : null;
      } else {
        patientObj = { id: p.id, first_name: p.first_name, last_name: p.last_name };
      }
    }

    let recorderObj = null;
    if (h.recorder) {
      const r = h.recorder as unknown as { id: string; full_name: string } | { id: string; full_name: string }[];
      if (Array.isArray(r)) {
        recorderObj = r[0] ? { id: r[0].id, full_name: r[0].full_name } : null;
      } else {
        recorderObj = { id: r.id, full_name: r.full_name };
      }
    }

    return {
      id: h.id,
      patient_id: h.patient_id,
      recorder_id: h.recorder_id,
      department: h.department,
      test_type: h.test_type,
      test_name: h.test_name,
      test_value: h.test_value,
      unit: h.unit,
      reference_range_min: h.reference_range_min,
      reference_range_max: h.reference_range_max,
      is_flagged: h.is_flagged,
      notes: h.notes,
      created_at: h.created_at,
      patient: patientObj,
      recorder: recorderObj
    };
  });

  // Neither query's error was previously read. An empty waiting list tells the
  // department nobody is queued; an empty history tells them no results have
  // been recorded. Both are wrong on a failed fetch and both lead to idleness.
  const loadError = queueError ?? historyError;

  if (loadError) {
    console.error("[DepartmentRecordsPage] Failed to load department data:", loadError);
  }

  return (
    <>
      {loadError ? (
        <div className="mb-6">
          <DataLoadError
            what={`the ${dept} queue and results`}
            error={loadError}
            retryHref={`/department/records`}
          />
        </div>
      ) : null}
      <DepartmentRecordsClient
        initialQueue={queue}
        initialHistory={history}
        activeDept={dept}
        userRole={profile.role}
      />
    </>
  );
}
