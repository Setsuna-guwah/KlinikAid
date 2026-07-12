import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TemplatesClient from "@/components/TemplatesClient";

export const dynamic = "force-dynamic";

export interface PatientIdentityProps {
  fullName: string;
  dateOfBirth: string;
  contactNumber: string;
  address: string;
}

export default async function PatientTemplatesPage() {
  const supabase = createClient();

  // 1. Auth gate
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/login");
  }

  // 2. Verify patient role
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || profile.role !== "patient") {
    redirect("/patient/dashboard");
  }

  // 3. Fetch patient identity for prefill (#41 — server-inject, not re-ask)
  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("first_name, last_name, date_of_birth, contact_number, address")
    .eq("profile_id", user.id)
    .single();

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
