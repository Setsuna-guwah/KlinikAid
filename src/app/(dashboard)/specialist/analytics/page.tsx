import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/helpers";

export const dynamic = "force-dynamic";

export default async function SpecialistAnalyticsPage() {
  await requirePermission("specialist.analytics");
  redirect("/specialist/patients");
}
