import React from "react";
import { requirePermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import SpecialistRecordEntryClient from "@/components/SpecialistRecordEntryClient";
import DataLoadError from "@/components/DataLoadError";
import { classifyRead } from "@/lib/read-outcome";

interface PageProps {
  params: {
    patientId: string;
  };
}

export const dynamic = "force-dynamic";

export default async function SpecialistRecordEntryPage({ params }: PageProps) {
  const profile = await requirePermission("specialist.records");
  const { patientId } = params;

  const supabase = createClient();

  // Fetch specialist private patient demographics
  const lookup = classifyRead(
    await supabase.from("specialist_patients").select("*").eq("id", patientId).single()
  );

  // "This patient does not exist" and "we could not read the patient row" are
  // different facts, and a specialist acting on the wrong one either files a
  // result against the wrong record or concludes the patient was archived and
  // skips them. notFound() asserts the first; only a confirmed zero-row match
  // may claim it.
  if (lookup.kind === "failed") {
    console.error("Failed to load specialist patient for record entry:", lookup.error);
    return (
      <div className="space-y-6">
        <DataLoadError
          what="this patient"
          error={lookup.error}
          retryHref={`/specialist/patients/${patientId}/record-entry`}
        />
      </div>
    );
  }

  if (lookup.kind === "absent") {
    notFound();
  }

  const patient = lookup.data;

  // Double check ownership
  if (patient.specialist_id !== profile.id) {
    redirect("/specialist/patients");
  }

  return (
    <SpecialistRecordEntryClient patient={patient} />
  );
}
