import React from "react";
import { requireRole } from "@/lib/auth/helpers";
import TemplatesClient from "@/components/TemplatesClient";

export const dynamic = "force-dynamic";

export default async function PatientTemplatesPage() {
  // Gate route to patient role
  await requireRole(["patient"]);

  return <TemplatesClient />;
}
