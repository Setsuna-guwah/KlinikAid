import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The session identity used by the dashboard after issue #165.
 *
 * The access token is verified locally against the project's signing keys, so
 * these tests sign a real ES256 token and check that the identity the guards
 * receive is the one the token carries - and that a token nobody signed, or a
 * token that does not belong to the session the middleware confirmed, is
 * refused.
 */

const AUTH_USER_HEADER = "x-klinikaid-auth-user";

const mocks = vi.hoisted(() => ({
  client: null as SupabaseClient | null,
  requestHeaders: new Headers(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (!mocks.client) throw new Error("the test did not provide a client");
    return mocks.client;
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => mocks.requestHeaders,
}));

const PROJECT_URL = "https://project.supabase.co";
const ANON_KEY = "anon-key";

function base64url(bytes: Uint8Array | string): string {
  const buffer = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return Buffer.from(buffer).toString("base64url");
}

// The same WebCrypto implementation the Auth client verifies with.
const subtle = globalThis.crypto.subtle;

async function signingKey(kid: string) {
  const pair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await subtle.exportKey("jwk", pair.publicKey);
  return {
    pair,
    jwk: { ...jwk, kid, alg: "ES256", use: "sig", key_ops: ["verify"] },
  };
}

async function signToken(
  key: Awaited<ReturnType<typeof signingKey>>,
  claims: Record<string, unknown>
): Promise<string> {
  const header = { alg: "ES256", kid: key.jwk.kid, typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claims)
  )}`;
  const signature = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key.pair.privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: `${PROJECT_URL}/auth/v1`,
    sub: "user-123",
    aud: "authenticated",
    role: "authenticated",
    email: "clinic@example.com",
    iat: now,
    exp: now + 3600,
    app_metadata: { must_change_password: true },
    user_metadata: { full_name: "E2E Admin" },
    ...overrides,
  };
}

function clientWithToken(token: string | null): SupabaseClient {
  // The Supabase client starts a realtime client, which only needs a
  // WebSocket constructor to exist; nothing here subscribes to anything.
  (globalThis as { WebSocket?: unknown }).WebSocket = class NoopWebSocket {};
  const client = createClient(PROJECT_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // The session comes from the request cookies in the app; here it is the
  // token under test.
  (client.auth as unknown as { getSession: () => Promise<unknown> }).getSession = async () =>
    token
      ? { data: { session: { access_token: token } }, error: null }
      : { data: { session: null }, error: null };
  return client;
}

/**
 * A fresh copy of the module, so that its cache of signing keys starts empty
 * in every test.
 */
async function freshSession() {
  vi.resetModules();
  return import("./session");
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROJECT_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
  // The middleware confirmed this session for the request.
  mocks.requestHeaders = new Headers({ [AUTH_USER_HEADER]: "user-123" });
});

describe("getRequestUser", () => {
  it("returns the identity the signed token carries", async () => {
    const key = await signingKey("kid-1");
    const token = await signToken(key, claims());
    mocks.client = clientWithToken(token);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("jwks.json")) {
          return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${input}`);
      })
    );

    const { getRequestUser } = await freshSession();
    const user = await getRequestUser();

    expect(user?.id).toBe("user-123");
    expect(user?.email).toBe("clinic@example.com");
    // The temporary-password flag lives in app_metadata and must survive.
    expect(user?.app_metadata?.must_change_password).toBe(true);
  });

  it("returns nothing when the request carries no session", async () => {
    mocks.client = clientWithToken(null);
    const { getRequestUser } = await freshSession();
    await expect(getRequestUser()).resolves.toBeNull();
  });

  it("refuses a token nobody signed with the project's key", async () => {
    const trusted = await signingKey("kid-1");
    const stranger = await signingKey("kid-2");
    const token = await signToken(stranger, claims());
    mocks.client = clientWithToken(token);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("jwks.json")) {
          return new Response(JSON.stringify({ keys: [trusted.jwk] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${input}`);
      })
    );

    const { getRequestUser } = await freshSession();
    await expect(getRequestUser()).resolves.toBeNull();
  });

  it("refuses a token that does not belong to the session the middleware confirmed", async () => {
    const key = await signingKey("kid-1");
    const token = await signToken(key, claims());
    mocks.client = clientWithToken(token);

    // The middleware confirmed a different session for this request.
    mocks.requestHeaders = new Headers({ [AUTH_USER_HEADER]: "someone-else" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("jwks.json")) {
          return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${input}`);
      })
    );

    const { getRequestUser } = await freshSession();
    await expect(getRequestUser()).resolves.toBeNull();
  });

  it("refuses a token when the middleware confirmed no session at all", async () => {
    const key = await signingKey("kid-1");
    const token = await signToken(key, claims());
    mocks.client = clientWithToken(token);

    // The middleware's session check failed, so it wrote no identity.
    mocks.requestHeaders = new Headers();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("jwks.json")) {
          return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${input}`);
      })
    );

    const { getRequestUser } = await freshSession();
    await expect(getRequestUser()).resolves.toBeNull();
  });

  it("refuses an expired token even though its signature is valid", async () => {
    const key = await signingKey("kid-1");
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(key, claims({ iat: now - 7200, exp: now - 3600 }));
    mocks.client = clientWithToken(token);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("jwks.json")) {
          return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${input}`);
      })
    );

    const { getRequestUser } = await freshSession();
    await expect(getRequestUser()).resolves.toBeNull();
  });

  it("refuses an unsigned token", async () => {
    const key = await signingKey("kid-1");
    const header = base64url(JSON.stringify({ alg: "ES256", kid: "kid-1", typ: "JWT" }));
    const token = `${header}.${base64url(JSON.stringify(claims()))}.`;
    mocks.client = clientWithToken(token);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("jwks.json")) {
          return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${input}`);
      })
    );

    const { getRequestUser } = await freshSession();
    await expect(getRequestUser()).resolves.toBeNull();
  });

  it("refuses a token whose claims were edited after it was signed", async () => {
    // An aal1 token re-labelled as aal2 must not pass the staff MFA gate.
    const key = await signingKey("kid-1");
    const signed = await signToken(key, claims({ aal: "aal1" }));
    const [header, , signature] = signed.split(".");
    const forged = base64url(JSON.stringify(claims({ aal: "aal2" })));
    mocks.client = clientWithToken(`${header}.${forged}.${signature}`);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("jwks.json")) {
          return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${input}`);
      })
    );

    const { getRequestSession } = await freshSession();
    await expect(getRequestSession()).resolves.toBeNull();
  });

  it("reports the aal the verified token was issued at", async () => {
    const key = await signingKey("kid-1");
    mocks.client = clientWithToken(await signToken(key, claims({ aal: "aal2" })));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("jwks.json")) {
          return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${input}`);
      })
    );

    const { getRequestSession } = await freshSession();
    const session = await getRequestSession();
    expect(session?.aal).toBe("aal2");
    expect(session?.user.id).toBe("user-123");
  });

  it("reports no aal when the token carries none", async () => {
    const key = await signingKey("kid-1");
    mocks.client = clientWithToken(await signToken(key, claims()));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("jwks.json")) {
          return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${input}`);
      })
    );

    const { getRequestSession } = await freshSession();
    await expect(getRequestSession()).resolves.toMatchObject({ aal: null });
  });

  it("fetches the signing keys once and reuses them", async () => {
    const key = await signingKey("kid-1");
    const token = await signToken(key, claims());
    mocks.client = clientWithToken(token);

    const fetchMock = vi.fn(async (input: string) => {
      if (String(input).includes("jwks.json")) {
        return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getRequestUser } = await freshSession();
    await getRequestUser();
    await getRequestUser();

    const keyFetches = fetchMock.mock.calls.filter((call) => String(call[0]).includes("jwks.json"));
    expect(keyFetches).toHaveLength(1);
  });
});
