import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import SubmissionsClient from "./SubmissionsClient";
import DataLoadError from "@/components/DataLoadError";
import { Document, PatientQueue } from "@/types";

export const dynamic = "force-dynamic";

export default async function PatientSubmissionsPage() {
  const supabase = await createClient();

  // 1. Get current authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 2. Fetch patient record linked via profile_id
  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id")
    .eq("profile_id", user.id)
    .single();

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

  // 3. Fetch documents and queue in parallel
  const [docsResult, queueResult] = await Promise.all([
    supabase
      .from("documents")
      .select("*")
      .eq("patient_id", patient.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("patient_queue")
      .select("*")
      .eq("patient_id", patient.id)
      .order("created_at", { ascending: false })
  ]);

  const documents = (docsResult.data || []) as Document[];
  const queue = (queueResult.data || []) as PatientQueue[];

  // These two fetches are parallel and their errors are otherwise never read.
  // A failure here renders as "you have not submitted anything", which tells a
  // patient their uploads vanished rather than that they could not be loaded.
  const loadError = docsResult.error ?? queueResult.error;

  if (loadError) {
    console.error("[PatientSubmissionsPage] Failed to load submissions:", loadError);
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {loadError ? (
        <DataLoadError
          what="your submissions"
          error={loadError}
          retryHref="/patient/submissions"
        />
      ) : null}
      {loadError ? null : (
        <SubmissionsClient
          initialDocuments={documents}
          initialQueue={queue}
          patientId={patient.id}
        />
      )}
    </div>
  );
}
