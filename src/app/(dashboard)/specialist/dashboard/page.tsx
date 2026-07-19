import React from "react";
import { requirePermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import SpecialistDashboardClient from "@/components/SpecialistDashboardClient";

export const dynamic = "force-dynamic";

export default async function SpecialistDashboardPage() {
  // Guard route for medical_specialist or admin
  await requirePermission("specialist.patients");

  const supabase = createClient();

  // 1. Fetch total count of patients from specialist_patients
  const { count: totalPatients, error: totalPatientsError } = await supabase
    .from("specialist_patients")
    .select("id", { count: "exact", head: true });

  if (totalPatientsError) {
    console.error("Error fetching total patients:", totalPatientsError);
  }

  // 2. Fetch flagged count in the last 7 days from specialist_records
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: flaggedThisWeek, error: flaggedError } = await supabase
    .from("specialist_records")
    .select("id", { count: "exact", head: true })
    .eq("is_flagged", true)
    .gte("created_at", sevenDaysAgo);

  if (flaggedError) {
    console.error("Error fetching flagged count:", flaggedError);
  }

  // 3. Get count of distinct test groups in records
  const testGroups = ["Complete Blood Count (CBC)", "Fasting Blood Sugar (FBS)", "Renal Function", "Lipid Profile"];
  const groupCounts = await Promise.all(
    testGroups.map(async (group) => {
      const { count, error } = await supabase
        .from("specialist_records")
        .select("id", { count: "exact", head: true })
        .eq("test_type", group);
      if (error) {
        console.error(`Error counting records for group ${group}:`, error);
        return 0;
      }
      return count || 0;
    })
  );
  const departmentsCovered = groupCounts.filter((c) => c > 0).length;

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

  const stats = {
    totalPatients: totalPatients || 0,
    flaggedThisWeek: flaggedThisWeek || 0,
    departmentsCovered
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
    <SpecialistDashboardClient
      stats={stats}
      recentFlagged={formattedRecentFlagged}
      recentPatients={recentPatients}
    />
  );
}
