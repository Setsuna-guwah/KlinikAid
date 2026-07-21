import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, hasAnyPermission } from "@/lib/auth/helpers";
import RecordEntryClient from "@/components/RecordEntryClient";
import { Department } from "@/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: {
    patientId: string;
  };
  searchParams: {
    department?: string;
  };
}

export default async function RecordEntryPage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const { patientId } = params;
  const { user, profile } = await getCurrentUser();

  if (!user || !profile) {
    redirect("/login");
  }

  // 1. Enforce RBAC for department record entry
  const canAccessRecordEntry = await hasAnyPermission(user.id, [
    "records.manage",
    "records.manage.own_dept",
  ]);
  if (!canAccessRecordEntry) {
    redirect("/403");
  }
  const canSelectDepartmentContext = await hasAnyPermission(user.id, ["records.manage"]);

  // 2. Resolve department
  let dept = profile.department;
  if (canSelectDepartmentContext) {
    dept = (searchParams.department as Department) || profile.department || "laboratory";
  }

  if (!dept || !["laboratory", "imaging", "ultrasound", "ecg"].includes(dept)) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-xl font-bold text-red-500">Access Denied</h1>
        <p className="text-slate-500 mt-2">Your profile is not assigned to a valid department.</p>
      </div>
    );
  }

  // 3. Fetch patient demographics
  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("*")
    .eq("id", patientId)
    .single();

  if (patientError || !patient) {
    return (
      <div className="p-6 text-center space-y-4">
        <h1 className="text-xl font-bold text-red-500">Patient Not Found</h1>
        <p className="text-slate-500">The patient ID does not exist in our records.</p>
        <a 
          href="/department/records" 
          className="inline-block px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg text-sm transition-all"
        >
          Return to Dashboard
        </a>
      </div>
    );
  }

  // 4. Fetch history for context/comparison
  const { data: historyData } = await supabase
    .from("department_records")
    .select(`
      id,
      test_type,
      test_name,
      test_value,
      unit,
      reference_range_min,
      reference_range_max,
      is_flagged,
      notes,
      created_at,
      recorder:recorder_id (
        full_name
      )
    `)
    .eq("patient_id", patientId)
    .eq("department", dept)
    .order("created_at", { ascending: false });

  const history = (historyData || []).map((h) => {
    let recorderObj = null;
    if (h.recorder) {
      const rec = h.recorder as unknown as { full_name: string } | { full_name: string }[];
      if (Array.isArray(rec)) {
        recorderObj = rec[0] ? { full_name: rec[0].full_name } : null;
      } else {
        recorderObj = { full_name: rec.full_name };
      }
    }
    return {
      id: h.id,
      test_type: h.test_type,
      test_name: h.test_name,
      test_value: h.test_value,
      unit: h.unit,
      reference_range_min: h.reference_range_min,
      reference_range_max: h.reference_range_max,
      is_flagged: h.is_flagged,
      notes: h.notes,
      created_at: h.created_at,
      recorder: recorderObj
    };
  });

  return (
    <RecordEntryClient 
      patient={patient} 
      history={history} 
      activeDept={dept}
    />
  );
}
