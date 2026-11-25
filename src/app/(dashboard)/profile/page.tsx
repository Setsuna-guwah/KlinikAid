import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifiedSessionWith } from "@/lib/auth/helpers";
import ProfileClient from "./ProfileClient";
import { Department, UserRole } from "@/types";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();

  // Full profile info, read beside the session's revocation check (#238).
  const verified = await verifiedSessionWith((id) =>
    supabase.from("profiles").select("full_name, role, department").eq("id", id).single()
  );
  if (!verified) {
    redirect("/login");
  }

  const { user } = verified;
  const { data: profile } = verified.value;

  if (!profile) {
    redirect("/login");
  }

  let patientData: {
    contactNumber: string;
    address: string;
    dateOfBirth: string;
    gender: string;
  } | null = null;

  if (profile.role === "patient") {
    const { data: patient } = await supabase
      .from("patients")
      .select("contact_number, address, date_of_birth, gender")
      .eq("profile_id", user.id)
      .single();

    if (patient) {
      patientData = {
        contactNumber: patient.contact_number || "",
        address: patient.address || "",
        dateOfBirth: patient.date_of_birth || "",
        gender: patient.gender || "",
      };
    }
  }

  const profileData = {
    fullName: profile.full_name,
    email: user.email || "",
    role: profile.role as UserRole,
    department: profile.department as Department | null,
  };

  return <ProfileClient user={profileData} patient={patientData} />;
}
