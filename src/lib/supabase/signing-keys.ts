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

let cachedSigningKeys: SigningKey[] = [];
let cachedSigningKeysAt = 0;
let signingKeysInFlight: Promise<SigningKey[]> | null = null;

async function fetchSigningKeys(): Promise<SigningKey[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase client environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  const response = await fetch(`${url}/auth/v1/.well-known/jwks.json`, {
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
  if (cachedSigningKeys.length > 0 && now - cachedSigningKeysAt < SIGNING_KEY_TTL_MS) {
    return cachedSigningKeys;
  }

  if (!signingKeysInFlight) {
    signingKeysInFlight = fetchSigningKeys()
      .then((keys) => {
        cachedSigningKeys = keys;
        cachedSigningKeysAt = Date.now();
        return keys;
      })
      .catch((error) => {
        // Keep whatever keys are already known rather than failing the request:
        // `getClaims()` fetches the key set itself when it cannot use ours.
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
