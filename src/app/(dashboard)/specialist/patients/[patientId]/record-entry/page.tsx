import React from "react";
import { requirePermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import SpecialistRecordEntryClient from "@/components/SpecialistRecordEntryClient";

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
  const { data: patient, error } = await supabase
    .from("specialist_patients")
    .select("*")
    .eq("id", patientId)
    .single();

  if (error || !patient) {
    console.error("Failed to load specialist patient for record entry:", error);
    notFound();
  }

  // Double check ownership
  if (patient.specialist_id !== profile.id) {
    redirect("/specialist/patients");
  }

  return (
    <SpecialistRecordEntryClient patient={patient} />
  );
}
