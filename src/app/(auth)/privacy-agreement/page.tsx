import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PrivacyAgreementClient from "./PrivacyAgreementClient";

export const dynamic = "force-dynamic";

export default async function PrivacyAgreementPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch profiles
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, accepted_privacy_at")
    .eq("id", user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut();
    redirect("/login");
  }

  // If already accepted or not a patient, bypass
  if (profile.role !== "patient" || profile.accepted_privacy_at) {
    redirect("/patient/dashboard");
  }

  return <PrivacyAgreementClient />;
}
