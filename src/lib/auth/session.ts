import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSigningKeys, userFromClaims } from "@/lib/supabase/signing-keys";
import { AUTH_USER_HEADER } from "@/lib/auth/auth-header";
import { timed } from "@/lib/perf/timing";
import type { User } from "@supabase/supabase-js";

/**
 * The identity behind the current request, and whether that session is still
 * live (issues #165 and #238).
 *
 * Two checks run for every request that reaches server code, side by side:
 *
 * - The access token's signature is verified locally against the project's
 *   signing keys (`getClaims()`). This is the identity and the `aal` claim.
 *   The project signs tokens with ES256, so no network call is needed for it.
 * - `getUser()` asks the Auth server whether the session still exists. A
 *   signed-out or revoked session has a token whose signature is still valid
 *   until it expires, so only this call can refuse it. It runs in the same
 *   region as the database, so it is a short round trip.
 *
 * The revocation answer gates the session. A revoked session returns null from
 * here, and callers must not use anything they read on its behalf. The dashboard
 * layout starts its profile and permission reads before it awaits the
 * revocation answer (`startRequestSession`), so that wait overlaps those reads.
 *
 * The locally verified identity is only accepted when it is the identity the
 * middleware verified for this request, which the middleware writes into the
 * `x-klinikaid-auth-user` request header. A client cannot set that header: the
 * middleware removes it from every request before it writes its own.
 *
 * `getClaims()` falls back to asking the Auth server when the token is signed
 * with a symmetric key or when the signing key is unknown, so a change of
 * signing scheme degrades to the previous behaviour instead of failing.
 */

/**
 * The verified session of the current request: its user, and the assurance
 * level (`aal`) the access token was issued at.
 *
 * The `aal` claim is read from the same token whose signature was just
 * verified, so it is as trustworthy as the identity. It is what the dashboard
 * layout uses to tell an MFA-verified session (`aal2`) from one that still
 * needs its second factor, without asking the Auth server for the factor list
 * on every navigation.
 */
export type RequestSession = {
  user: User;
  /** `aal1`, `aal2`, or null when the token carries no assurance claim. */
  aal: string | null;
};

/**
 * A session whose token verified locally, with the revocation answer still
 * on its way. `live` resolves to true only when the Auth server confirmed the
 * session. It never rejects.
 */
export type PendingRequestSession = {
  session: RequestSession;
  live: Promise<boolean>;
};

/**
 * Starts the request's session checks and returns before the revocation
 * answer arrives, so the caller can start reads that need only the user id.
 * The caller must await `live` before it uses anything it read.
 *
 * `cache()` collapses the calls made by the layout, the page and the auth
 * helpers into one verification per request.
 */
export const startRequestSession = cache(async (): Promise<PendingRequestSession | null> => {
  try {
    const supabase = await createClient();

    // Reads the session from the request cookies. It refreshes the access
    // token when the stored one has expired, which is the same refresh the
    // middleware performs.
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (sessionError || !accessToken) {
      return null;
    }

    // The identity the middleware verified for this request. Without it, the
    // token was not checked against this request's session, and a token whose
    // signature is still valid is not enough on its own.
    const requestHeaders = await headers();
    const verifiedId = requestHeaders.get(AUTH_USER_HEADER);
    if (!verifiedId) {
      return null;
    }

    // The revocation check starts now and runs alongside the local
    // verification below. It cannot throw into the caller: any failure is a
    // session that was not confirmed.
    const live = timed("auth.session.getUser", () => supabase.auth.getUser(accessToken)).then(
      ({ data, error }) => !error && data.user?.id === verifiedId,
      () => false
    );

    const keys = await getSigningKeys();
    const { data, error } = await timed("auth.session.getClaims", () =>
      supabase.auth.getClaims(accessToken, { jwks: { keys } })
    );

    if (error || !data?.claims?.sub) {
      console.error("Could not verify the session token:", error?.message ?? "no subject claim");
      return null;
    }

    const claims = data.claims;
    if (claims.sub !== verifiedId) {
      // The token and the session the middleware checked are not the same
      // person. Refuse rather than trust either side.
      console.error("The session token does not belong to the confirmed session.");
      return null;
    }

    return {
      session: {
        user: userFromClaims(claims),
        aal: typeof claims.aal === "string" ? claims.aal : null,
      },
      live,
    };
  } catch (error) {
    console.error("Error in startRequestSession:", error);
    return null;
  }
});

/**
 * The signed-in session of the current request, or null when there is no valid
 * session or the Auth server no longer recognises it.
 */
export const getRequestSession = cache(async (): Promise<RequestSession | null> => {
  const pending = await startRequestSession();
  if (!pending) return null;

  if (!(await pending.live)) {
    console.error("The session is no longer live; refusing the request.");
    return null;
  }
  return pending.session;
});

/**
 * The signed-in user of the current request, or null when there is no valid
 * session.
 */
export const getRequestUser = cache(async (): Promise<User | null> => {
  const session = await getRequestSession();
  return session?.user ?? null;
});
