import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifiedSessionWith } from "@/lib/auth/helpers";
import DocumentSubmitClient from "./DocumentSubmitClient";

export const dynamic = "force-dynamic";

export default async function PatientSubmitPage() {
  const supabase = await createClient();

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
    redirect("/patient/dashboard"); // Redirect if not properly linked as patient
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Submit Document</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Upload referral files or doctor request scripts securely
        </p>
      </div>
      <DocumentSubmitClient />
    </div>
  );
}
