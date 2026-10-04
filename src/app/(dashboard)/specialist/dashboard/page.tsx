import React from "react";
import { requirePermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import SpecialistDashboardClient from "@/components/SpecialistDashboardClient";
import DataLoadError from "@/components/DataLoadError";
import { classifyRead, readErrors } from "@/lib/read-outcome";

export const dynamic = "force-dynamic";

export default async function SpecialistDashboardPage() {
  // Guard route for medical_specialist or admin
  await requirePermission("specialist.patients");

  const supabase = createClient();

  // 1. Fetch total count of patients from specialist_patients
  const totalPatientsResult = await supabase
    .from("specialist_patients")
    .select("id", { count: "exact", head: true });

  if (totalPatientsResult.error) {
    console.error("Error fetching total patients:", totalPatientsResult.error);
  }

  // A head-count query reports its answer in `count`, not `data`, so the count
  // is what gets classified. Feeding `data` (always null here) instead would
  // make every count look like a successful zero.
  const totalPatientsRead = classifyRead({
    data: totalPatientsResult.count,
    error: totalPatientsResult.error,
  });

  // 2. Fetch flagged count in the last 7 days from specialist_records
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const flaggedResult = await supabase
    .from("specialist_records")
    .select("id", { count: "exact", head: true })
    .eq("is_flagged", true)
    .gte("created_at", sevenDaysAgo);

  if (flaggedResult.error) {
    console.error("Error fetching flagged count:", flaggedResult.error);
  }

  const flaggedRead = classifyRead({
    data: flaggedResult.count,
    error: flaggedResult.error,
  });

  // 3. Get count of distinct test groups in records
  const testGroups = ["Complete Blood Count (CBC)", "Fasting Blood Sugar (FBS)", "Renal Function", "Lipid Profile"];
  const groupReads = await Promise.all(
    testGroups.map(async (group) => {
      const { count, error } = await supabase
        .from("specialist_records")
        .select("id", { count: "exact", head: true })
        .eq("test_type", group);
      if (error) {
        console.error(`Error counting records for group ${group}:`, error);
      }
      return classifyRead({ data: count, error });
    })
  );

  // These four used to `return 0` on error and their errors were never
  // collected, which is how a partial failure rendered as a healthy dashboard
  // reporting "Departments Covered 0" with no banner at all. Their errors now
  // feed the same aggregate as every other query on the page.
  const departmentsCoveredKnown = groupReads.every((read) => read.kind === "ok");
  const departmentsCovered = groupReads.filter(
    (read) => read.kind === "ok" && (read.data ?? 0) > 0
  ).length;

  // 4. Fetch 10 most recent flagged results joining specialist_patients (referenced as patient)
  const { data: recentFlaggedData, error: flaggedListError } = await supabase
    .from("specialist_records")
    .select(`
      id,
      test_name,
      test_value,
      unit,
      reference_range_min,
      reference_range_max,
      created_at,
      patient:specialist_patient_id (
        id,
        first_name,
        last_name
      )
    `)
    .eq("is_flagged", true)
    .order("created_at", { ascending: false })
    .limit(10);

  if (flaggedListError) {
    console.error("Error fetching recent flagged records:", flaggedListError);
  }

  // 5. Fetch recent patient activity (last 5 active patients)
  const { data: recentActivity, error: activityError } = await supabase
    .from("specialist_records")
    .select(`
      created_at,
      patient:specialist_patient_id (
        id,
        first_name,
        last_name
      )
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (activityError) {
    console.error("Error fetching recent activity records:", activityError);
  }

  const recentPatientsMap = new Map();
  for (const rec of recentActivity || []) {
    const rawPatient = rec.patient;
    const patient = Array.isArray(rawPatient)
      ? rawPatient[0]
      : (rawPatient as unknown as { id: string; first_name: string; last_name: string } | null);

    if (patient && !recentPatientsMap.has(patient.id)) {
      recentPatientsMap.set(patient.id, {
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        last_activity: rec.created_at
      });
    }
    if (recentPatientsMap.size >= 5) {
      break;
    }
  }
  const recentPatients = Array.from(recentPatientsMap.values());

  // Every widget on this dashboard is a count or a list built from a query that
  // can fail independently. On failure each one degrades to a confident zero or
  // an empty list, and the specialist reads "0 patients", "0 flagged this week"
  // and an empty critical-results list as fact. The single most dangerous of
  // these is recentFlagged: a failed query presents as "no out-of-range results
  // this week", which is exactly the claim a specialist must never be misled
  // about. The failures are therefore surfaced as a banner rather than being
  // summed into the widgets, so no number below is silently fabricated.
  //
  // All eight queries contribute. An earlier version listed only four, so the
  // four group counts could fail on their own and the dashboard rendered
  // "Active Modalities 0" with no indication anything was wrong -- a partial
  // failure, which is the case a whole-table REVOKE probe cannot reproduce.
  const loadErrors = readErrors([
    totalPatientsRead,
    flaggedRead,
    classifyRead({ data: recentFlaggedData, error: flaggedListError }),
    classifyRead({ data: recentActivity, error: activityError }),
    ...groupReads,
  ]);

  const stats = {
    // null means "not measured", which is rendered as such. Zero means
    // "measured, and there were none" -- a different and equally important
    // claim. Collapsing the two is what the banner above exists to prevent.
    totalPatients: totalPatientsRead.kind === "ok" ? totalPatientsRead.data : null,
    flaggedThisWeek: flaggedRead.kind === "ok" ? flaggedRead.data : null,
    departmentsCovered: departmentsCoveredKnown ? departmentsCovered : null,
  };

  const formattedRecentFlagged = (recentFlaggedData || []).map((r) => {
    const rawPatient = r.patient;
    const patient = Array.isArray(rawPatient)
      ? rawPatient[0]
      : (rawPatient as unknown as { id: string; first_name: string; last_name: string } | null);

    return {
      id: r.id,
      test_name: r.test_name,
      test_value: r.test_value,
      unit: r.unit,
      reference_range_min: r.reference_range_min,
      reference_range_max: r.reference_range_max,
      created_at: r.created_at,
      patient: patient ? {
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name
      } : null
    };
  });

  return (
    <>
      {loadErrors.length > 0 ? (
        <div className="mb-6">
          <DataLoadError
            what="your specialist dashboard"
            error={loadErrors[0]}
            retryHref="/specialist/dashboard"
          />
        </div>
      ) : null}
      <SpecialistDashboardClient
        stats={stats}
        recentFlagged={formattedRecentFlagged}
        recentPatients={recentPatients}
      />
    </>
  );
}
