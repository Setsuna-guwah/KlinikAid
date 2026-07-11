import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ProfileClient from "./ProfileClient";
import { Department, UserRole } from "@/types";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // Fetch full profile info
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, department")
    .eq("id", user.id)
    .single();

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
