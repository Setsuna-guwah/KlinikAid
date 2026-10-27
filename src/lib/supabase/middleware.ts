import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { fetchWithSigningKeyDeadline, getSigningKeys, userFromClaims } from "@/lib/supabase/signing-keys";

/**
 * Refreshes the user's session on every request, updating the cookies appropriately.
 * Returns the modified response, the Supabase client instance and the session's
 * user.
 *
 * The user comes from the access token's signature, verified locally against
 * the project's signing keys (`getClaims()`), not from an Auth server call.
 * The middleware runs at the edge, which is in a different region from the
 * Auth server and the database, so a network check here cost a cross-region
 * round trip on every request (issue #238). The revocation check that a signed
 * out or revoked session is refused is made by server code next to the
 * database (`src/lib/auth/session.ts`), and it still refuses such a session
 * before anything is rendered or returned.
 *
 * `getClaims()` without a token reads the session from the request cookies and
 * refreshes an expired access token first, exactly as `getUser()` did, so the
 * refreshed cookies are still written by `setAll` below.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase client environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  const supabase = createServerClient(url, anonKey, {
    // Only the signing-key discovery request gets a deadline; everything else
    // the client sends goes out unchanged.
    global: { fetch: fetchWithSigningKeyDeadline },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // The signing keys come from a per-isolate cache. A client built for this
  // request has no key cache of its own, so passing the keys in avoids one
  // key-set fetch per request.
  const keys = await getSigningKeys();

  // IMPORTANT: Do not remove this call. It refreshes an expired access token
  // through the cookies, the same as getUser() did.
  const verifyStarted = Date.now();
  const { data, error } = await supabase.auth.getClaims(undefined, { jwks: { keys } });
  if (process.env.KLINIKAID_TIMING === "1") {
    console.log(
      `[KTIMING] ${new Date().toISOString()} ${request.headers.get("x-nonce") ?? "no-request"} mw.getClaims ${(
        Date.now() - verifyStarted
      ).toFixed(1)}`
    );
  }

  const claims = error ? null : data?.claims;
  const user = claims?.sub ? (userFromClaims(claims) as User) : null;

  return { supabaseResponse, supabase, user };
}
