import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "../csp.mjs";
import { updateSession } from "@/lib/supabase/middleware";
import { errorResponse } from "@/lib/api-response";
import {
  SET_PASSWORD_PATH,
  isAllowedWithTemporaryPassword,
  mustChangePassword,
} from "@/lib/auth/temporary-password";
import { AUTH_USER_HEADER } from "@/lib/auth/auth-header";

/**
 * The Access Denied landing page (`/403`) is a real page that reads the session
 * to choose the dashboard link and offer sign-out, but it must answer HTTP 403,
 * not 200: monitoring, caches and scripts otherwise read a forbidden response as
 * a successful page load. Rewriting to the page with a 403 status serves the
 * page's own body under the correct code, and the session-refresh cookies that
 * `updateSession` produced are carried over so a just-refreshed session still
 * reaches the browser.
 *
 * The rewrite must carry the nonce-forwarding request headers (issue #154):
 * this serves a real HTML page, so its inline scripts need the request's CSP
 * nonce to run, and its response needs the matching Content-Security-Policy.
 */
function forbiddenLanding(
  request: NextRequest,
  supabaseResponse: NextResponse,
  requestHeaders: Headers,
  csp: string
) {
  const res = NextResponse.rewrite(request.nextUrl, {
    status: 403,
    request: { headers: requestHeaders },
  });
  supabaseResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      res.headers.append(key, value);
    }
  });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export async function middleware(request: NextRequest) {
  // Per-request nonce, following the official Next.js App Router CSP guide
  // (issue #154). The nonce goes on the request itself, BEFORE updateSession:
  // that helper's NextResponse.next({ request }) forwards whatever the request
  // carries, and it recreates its response when cookies are refreshed — so a
  // copy made here would be lost on the unauthenticated and cookie-refresh
  // paths, leaving headers() with no x-nonce and next-themes' pre-paint script
  // un-nonceable. The full policy also goes on the request headers, as the
  // guide does, so anything reading headers() during the render can see it.
  // The render stamps the header's nonce on Next.js's own inline
  // scripts; the layout reads x-nonce for next-themes. Every response gets the
  // matching Content-Security-Policy: via `withCsp`, or inside
  // `forbiddenLanding`, so a redirect, an error JSON, a rewrite and a page
  // render all answer with the same header.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);
  const withCsp = <T extends NextResponse>(response: T): T => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  // Any value the client sent for the authenticated user's id is dropped
  // before the request is read: the header below is written by this
  // middleware from the session it verified, and a client must not be able to
  // put a name in it.
  request.headers.delete(AUTH_USER_HEADER);

  // The session was already read - and refreshed - by updateSession() above,
  // from the access token's signature. This is a routing decision only: the
  // server code behind every page and route asks the Auth server whether the
  // session is still live before it returns anything (src/lib/auth/session.ts).
  const { supabaseResponse, supabase, user } = await updateSession(request);
  const path = request.nextUrl.pathname;

  // The identity the signature of this request's token proved, for the server
  // code in src/lib/auth/session.ts. That code binds the token to this value
  // and then asks the Auth server whether the session is still live, so a
  // signed-out session is refused there, not here.
  if (user) {
    request.headers.set(AUTH_USER_HEADER, user.id);
  }

  // Already carries x-nonce (set above on the request itself).
  const requestHeaders = new Headers(request.headers);

  // Define route prefixes
  const isAdminRoute = path.startsWith("/admin");
  const isReceptionRoute = path.startsWith("/reception");
  const isDepartmentRoute = path.startsWith("/department");
  const isSpecialistRoute = path.startsWith("/specialist");
  const isPatientRoute = path.startsWith("/patient");

  const isProtectedRoute =
    isAdminRoute || isReceptionRoute || isDepartmentRoute || isSpecialistRoute || isPatientRoute;

  // 1. Unauthenticated users trying to access protected routes -> redirect to /login
  if (!user && isProtectedRoute) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", path);
    return withCsp(NextResponse.redirect(loginUrl));
  }

  // 2. Authenticated user logic
  if (user) {
    // A temporary password was seen by the receptionist who set it, so the
    // session it opens may only replace it. API routes get a 403 rather than
    // a redirect their fetch callers would follow into an HTML page.
    if (mustChangePassword(user) && !isAllowedWithTemporaryPassword(path)) {
      if (path.startsWith("/api/")) {
        return withCsp(errorResponse("Set a new password before continuing.", 403));
      }
      return withCsp(NextResponse.redirect(new URL(SET_PASSWORD_PATH, request.url)));
    }

    // Redirect already logged-in users away from login page to their dashboard
    if (request.method === "GET" && (path === "/login" || path === "/")) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      const role = profile?.role;
      if (role === "admin") return withCsp(NextResponse.redirect(new URL("/admin/dashboard", request.url)));
      if (role === "receptionist") return withCsp(NextResponse.redirect(new URL("/reception/dashboard", request.url)));
      if (role === "department_staff") return withCsp(NextResponse.redirect(new URL("/department/records", request.url)));
      if (role === "medical_specialist") return withCsp(NextResponse.redirect(new URL("/specialist/dashboard", request.url)));
      if (role === "patient") return withCsp(NextResponse.redirect(new URL("/patient/dashboard", request.url)));
    }

    // The Access Denied landing page is not a protected route, but an
    // authenticated user reaching it directly still passes the temporary-password
    // and login redirects above. Answer it with 403, not 200.
    if (path === "/403") {
      return forbiddenLanding(request, supabaseResponse, requestHeaders, csp);
    }

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

    return withCsp(nextResponse);
  }

  // Unauthenticated visitors to the Access Denied landing page get 403 as well.
  if (path === "/403") {
    return forbiddenLanding(request, supabaseResponse, requestHeaders, csp);
  }

  return withCsp(supabaseResponse);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - Images/assets under public
     *
     * That is every path which can serve HTML, so the Content-Security-Policy
     * (issue #154) is set on every HTML response this app produces; the
     * excluded paths are static assets only.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
