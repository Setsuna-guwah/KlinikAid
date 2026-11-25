import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifiedSessionWith } from "@/lib/auth/helpers";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import PatientResultsClient from "./PatientResultsClient";
import DataLoadError from "@/components/DataLoadError";
import { DepartmentRecord } from "@/types";

export const dynamic = "force-dynamic";

export default async function PatientResultsPage() {
  const supabase = await createClient();

  // 1. Get current authenticated user
  // The signed-in user and their patient record, read beside the session's
  // revocation check (#238).
  const verified = await verifiedSessionWith((id) =>
    supabase.from("patients").select("id").eq("profile_id", id).single()
  );

  if (!verified) {
    redirect("/login");
  }

  const { data: patient, error: patientError } = verified.value;

  if (patientError || !patient) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Profile Configuration Error</AlertTitle>
          <AlertDescription>
            We could not retrieve your patient record. Please contact clinic staff to link your authentication account.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // 3. Fetch released department records for this patient
  const { data: records, error: recordsError } = await supabase
    .from("department_records")
    .select("*")
    .eq("patient_id", patient.id)
    .order("created_at", { ascending: false });

  if (recordsError) {
    console.error("[PatientResultsPage] Error fetching department records:", recordsError);
  }

  // A failed fetch must not render as "you have no results". That tells a
  // patient their records are absent when they may exist and were simply
  // unreachable -- the worst possible place to assert an unverified absence.
  if (recordsError) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <DataLoadError
          what="your results"
          error={recordsError}
          retryHref="/patient/results"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PatientResultsClient initialRecords={(records || []) as DepartmentRecord[]} />
    </div>
  );
}
