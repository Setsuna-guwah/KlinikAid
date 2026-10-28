import type { JwtPayload } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

/**
 * The project's JSON Web Keys, and the user a verified token describes.
 *
 * Kept free of `next/headers` and the Node-only modules so the middleware (the
 * edge runtime) and the server code (the Sydney functions) can share one key
 * cache: a Supabase client built per request would otherwise fetch the key set
 * again on every request, because `getClaims()` caches keys on the client.
 */

/** A JSON Web Key from the project's key set. */
export type SigningKey = {
  kty: string;
  key_ops: string[];
  alg?: string;
  kid?: string;
  [key: string]: unknown;
};

/**
 * How long the fetched key set is reused. The signing keys change rarely;
 * `getClaims()` re-fetches them from the project when it meets a key id it
 * does not know, so a rotation cannot lock anyone out.
 */
const SIGNING_KEY_TTL_MS = 10 * 60 * 1000;

/**
 * How long a signing-key discovery request may take. Every request that needs
 * the key set awaits it — the middleware on a cache refresh, the server code
 * on a cold start — so a stalled discovery endpoint must not be able to hold
 * those requests open. The request is aborted at this deadline instead, and
 * `getSigningKeys()` keeps whatever keys it already knows, so verification
 * either uses those, asks the Auth server itself (the SDK's own discovery
 * request runs under the same deadline), or refuses the session. An
 * unavailable key set never makes verification succeed.
 */
export const SIGNING_KEY_FETCH_TIMEOUT_MS = 5_000;

/**
 * How long to wait after a failed refresh before trying the discovery
 * endpoint again while keys from an earlier fetch are still in memory.
 * Without it, every request during an outage would start a new discovery
 * request and could wait out its deadline, although the keys already known
 * still verify signatures.
 */
export const SIGNING_KEY_RETRY_BACKOFF_MS = 30_000;

let cachedSigningKeys: SigningKey[] = [];
let cachedSigningKeysAt = 0;
let lastSigningKeyFailureAt = 0;
let signingKeysInFlight: Promise<SigningKey[]> | null = null;

/** The URL a `fetch` call was given, whatever shape it arrived in. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * The `fetch` the Supabase clients are built with: the platform's own, except
 * that a signing-key discovery request is aborted at
 * `SIGNING_KEY_FETCH_TIMEOUT_MS` — headers and body alike. Every other
 * request the clients make is sent unchanged.
 *
 * The SDK fetches the key set itself when the keys passed to `getClaims()`
 * do not contain the token's key id (a rotation, or a failed fetch above);
 * without this deadline that request — and the verification waiting on it —
 * could hang on a stalled endpoint. A timeout surfaces from `getClaims()` as
 * a failed verification, so the session is refused rather than left hanging.
 */
export async function fetchWithSigningKeyDeadline(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (!requestUrl(input).endsWith("/.well-known/jwks.json")) {
    return fetch(input, init);
  }

  // A caller that already cancelled is not made to wait for the deadline:
  // the platform rejects the request at once on the caller's own signal.
  if (init?.signal?.aborted) {
    return fetch(input, init);
  }

  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  init?.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    init?.signal?.removeEventListener("abort", onCallerAbort);
  }, SIGNING_KEY_FETCH_TIMEOUT_MS);
  // The deadline and the caller's listener are released as soon as the
  // request is over — headers-only, body read through, failed, or aborted
  // at the deadline — so nothing is left attached behind a finished call.
  const done = () => {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", onCallerAbort);
  };
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.body) {
      // Nothing can stall after the headers of a body-less response.
      done();
      return response;
    }
    // `fetch()` resolves when the headers arrive; the body is read after
    // that (`response.json()` here and in the SDK), so the deadline must stay
    // live until the body is consumed. The pipe below clears the timer when
    // the body has been read through, and the signal stays attached to it,
    // so a body that stalls after its headers is aborted at the deadline
    // like the rest of the request.
    const body = response.body.pipeThrough(
      new TransformStream({
        flush() {
          done();
        },
      })
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    done();
    throw error;
  }
}

async function fetchSigningKeys(): Promise<SigningKey[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase client environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  const response = await fetchWithSigningKeyDeadline(`${url}/auth/v1/.well-known/jwks.json`, {
    headers: { apikey: anonKey },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Signing key discovery failed with status ${response.status}`);
  }

  const body = (await response.json()) as { keys?: Partial<SigningKey>[] };
  if (!Array.isArray(body.keys)) return [];

  return body.keys.map((key) => ({
    ...key,
    kty: key.kty ?? "oct",
    key_ops: Array.isArray(key.key_ops) ? key.key_ops : [],
  })) as SigningKey[];
}

/**
 * The project's signing keys, fetched once per process and reused.
 *
 * The fetch is a network round trip like the one it replaces, so it is worth
 * doing once rather than per request: a cold start pays for it, every
 * request after that reads the key set from memory.
 */
export async function getSigningKeys(): Promise<SigningKey[]> {
  const now = Date.now();
  // A successful fetch is remembered for the TTL even when it brought no
  // keys: a project on legacy symmetric signing answers the discovery
  // endpoint with an empty set, and re-fetching it on every request would
  // cost a round trip the token check never needs (such tokens carry no key
  // id, so `getClaims()` goes straight to the Auth server). An empty set
  // verifies nothing either way — it is the absence of keys, not a trust
  // decision — so serving it changes no answer, only the request count.
  if (now - cachedSigningKeysAt < SIGNING_KEY_TTL_MS) {
    return cachedSigningKeys;
  }

  // A refresh failed recently and keys from an earlier fetch are still in
  // memory: serve those instead of making every request wait out a new
  // discovery request against the same failing endpoint. They are used only
  // to verify signatures, as always — a token they cannot verify falls back
  // to the Auth server's own verification or is refused, never accepted.
  // With no keys in memory nothing is served: the request retries the fetch,
  // so a cold cache still fails closed rather than succeeding keylessly.
  if (
    cachedSigningKeys.length > 0 &&
    now - lastSigningKeyFailureAt < SIGNING_KEY_RETRY_BACKOFF_MS
  ) {
    return cachedSigningKeys;
  }

  if (!signingKeysInFlight) {
    signingKeysInFlight = fetchSigningKeys()
      .then((keys) => {
        cachedSigningKeys = keys;
        cachedSigningKeysAt = Date.now();
        lastSigningKeyFailureAt = 0;
        return keys;
      })
      .catch((error) => {
        // Keep whatever keys are already known rather than failing the request:
        // `getClaims()` fetches the key set itself when it cannot use ours,
        // under the same deadline. A failed fetch is never remembered as a
        // fresh key set; the backoff above serves the known keys for a short
        // window, and the next request after it tries the endpoint again.
        lastSigningKeyFailureAt = Date.now();
        console.error("Could not fetch the Supabase signing keys:", error);
        return cachedSigningKeys;
      });
  }

  try {
    return await signingKeysInFlight;
  } finally {
    signingKeysInFlight = null;
  }
}

/**
 * The user a verified access token describes. Only the fields the app reads
 * are copied: the id, email, the metadata flags and the issue time.
 */
export function userFromClaims(claims: JwtPayload): User {
  return {
    id: claims.sub as string,
    aud: claims.aud ?? "",
    email: claims.email ?? "",
    app_metadata: (claims.app_metadata as Record<string, unknown>) ?? {},
    user_metadata: (claims.user_metadata as Record<string, unknown>) ?? {},
    created_at: claims.iat ? new Date(claims.iat * 1000).toISOString() : new Date().toISOString(),
  } as User;
}
