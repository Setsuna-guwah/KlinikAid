import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifiedSessionWith } from "@/lib/auth/helpers";
import TemplatesClient from "@/components/TemplatesClient";

export const dynamic = "force-dynamic";

export interface PatientIdentityProps {
  fullName: string;
  dateOfBirth: string;
  contactNumber: string;
  address: string;
}

export default async function PatientTemplatesPage() {
  const supabase = await createClient();

  // 1. Auth gate
  // The profile (role check) and patient identity need only the user id, so
  // both are read beside the session's revocation check (#238).
  const verified = await verifiedSessionWith((id) =>
    Promise.all([
      supabase.from("profiles").select("role, full_name").eq("id", id).single(),
      supabase
        .from("patients")
        .select("first_name, last_name, date_of_birth, contact_number, address")
        .eq("profile_id", id)
        .single(),
    ])
  );
  if (!verified) {
    redirect("/login");
  }

  // 2. Verify patient role
  const [{ data: profile, error: profileError }, { data: patient, error: patientError }] = verified.value;

  if (profileError || !profile || profile.role !== "patient") {
    redirect("/patient/dashboard");
  }

  // 3. Patient identity for prefill (#41 — server-inject, not re-ask)
  if (patientError || !patient) {
    redirect("/patient/dashboard");
  }

  const patientIdentity: PatientIdentityProps = {
    fullName: `${patient.first_name} ${patient.last_name}`.trim(),
    dateOfBirth: patient.date_of_birth ?? "",
    contactNumber: patient.contact_number ?? "",
    address: patient.address ?? "",
  };

  return <TemplatesClient patientIdentity={patientIdentity} />;
}
