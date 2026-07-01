import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabaseResponse, supabase } = await updateSession(request);
  const path = request.nextUrl.pathname;

  // Define route prefixes
  const isAdminRoute = path.startsWith("/admin");
  const isReceptionRoute = path.startsWith("/reception");
  const isDepartmentRoute = path.startsWith("/department");
  const isSpecialistRoute = path.startsWith("/specialist");
  const isPatientRoute = path.startsWith("/patient");

  const isProtectedRoute =
    isAdminRoute || isReceptionRoute || isDepartmentRoute || isSpecialistRoute || isPatientRoute;

  // Retrieve user session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 1. Unauthenticated users trying to access protected routes -> redirect to /login
  if (!user && isProtectedRoute) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(loginUrl);
  }

  // 2. Authenticated user logic
  if (user) {
    // Redirect already logged-in users away from login page to their dashboard
    if (request.method === "GET" && (path === "/login" || path === "/")) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      const role = profile?.role;
      if (role === "admin") return NextResponse.redirect(new URL("/admin/dashboard", request.url));
      if (role === "receptionist") return NextResponse.redirect(new URL("/reception/dashboard", request.url));
      if (role === "department_staff") return NextResponse.redirect(new URL("/department/dashboard", request.url));
      if (role === "medical_specialist") return NextResponse.redirect(new URL("/specialist/dashboard", request.url));
      if (role === "patient") return NextResponse.redirect(new URL("/patient/dashboard", request.url));
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", path);
    
    const nextResponse = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    
    // Copy set-cookie headers to maintain session refresh
    supabaseResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        nextResponse.headers.append(key, value);
      }
    });
    
    return nextResponse;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - Images/assets under public
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
