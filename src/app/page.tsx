import { redirect } from "next/navigation";
import { getCurrentUser, getDefaultLandingPath } from "@/lib/auth/helpers";

export const dynamic = "force-dynamic";

/**
 * Root Landing Page redirecting to Login or respective Role Dashboard.
 */
export default async function Home() {
  const { user, profile } = await getCurrentUser();

  if (user && profile) {
    redirect(await getDefaultLandingPath(user.id, profile));
  }

  redirect("/login");
}
