import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ProfileClient from "./ProfileClient";
import { UserRole } from "@/types";

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

  const profileData = {
    fullName: profile.full_name,
    email: user.email || "",
    role: profile.role as UserRole,
    department: profile.department,
  };

  return <ProfileClient user={profileData} />;
}
