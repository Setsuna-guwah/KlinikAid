import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/helpers";
import { logoutAction } from "@/app/(auth)/logout/actions";
import { ShieldAlert, ArrowLeft, LogOut } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Access Denied | KlinikAid",
  description: "You do not have permission to access this resource.",
};

export default async function ForbiddenPage() {
  const { user, profile } = await getCurrentUser();

  // Determine dashboard link based on role
  let dashboardHref = "/login";
  if (profile) {
    if (profile.role === "admin") dashboardHref = "/admin/dashboard";
    else if (profile.role === "receptionist") dashboardHref = "/reception/dashboard";
    else if (profile.role === "department_staff") dashboardHref = "/department/dashboard";
    else if (profile.role === "medical_specialist") dashboardHref = "/specialist/dashboard";
    else if (profile.role === "patient") dashboardHref = "/patient/dashboard";
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
          <ShieldAlert className="h-8 w-8" />
        </div>
        
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Access Denied (403)
        </h1>
        
        <p className="mt-4 text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
          You do not have the required permissions to view this resource. 
          {profile ? (
            <span className="block mt-2 font-semibold">
              Current Role: <span className="capitalize text-indigo-600 dark:text-indigo-400">{profile.role.replace("_", " ")}</span>
            </span>
          ) : (
            <span className="block mt-2">Please log in to continue.</span>
          )}
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {profile ? (
            <Link
              href={dashboardHref}
              className={buttonVariants({ variant: "default", className: "w-full" })}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Go to Dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className={buttonVariants({ variant: "default", className: "w-full" })}
            >
              Back to Login
            </Link>
          )}

          {user && (
            <form action={logoutAction} className="w-full">
              <button
                type="submit"
                className={buttonVariants({ variant: "outline", className: "w-full text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20" })}
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign Out
              </button>
            </form>
          )}
        </div>
      </div>
      
      <p className="mt-8 text-xs text-slate-400 dark:text-slate-600">
        KlinikAid — Bloodcare Medical Laboratory Web Portal
      </p>
    </div>
  );
}
