import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  fetchWithSigningKeyDeadline,
  SIGNING_KEY_FETCH_TIMEOUT_MS,
} from "@/lib/supabase/signing-keys";

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
  /** What the Auth server answers for `getUser(token)`: the live-session check. */
  liveAnswer: { data: { user: { id: "user-123" } }, error: null } as {
    data: { user: { id: string } | null };
    error: { message: string } | null;
  },
  /** Order of the server-side checks, to prove they overlap. */
  calls: [] as string[],
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
    // The bounded `fetch` src/lib/supabase/server.ts builds the client with:
    // a stalled key discovery request is aborted at its deadline instead of
    // holding the verification open.
    global: { fetch: fetchWithSigningKeyDeadline },
  });
  // The session comes from the request cookies in the app; here it is the
  // token under test.
  (client.auth as unknown as { getSession: () => Promise<unknown> }).getSession = async () =>
    token
      ? { data: { session: { access_token: token } }, error: null }
      : { data: { session: null }, error: null };
  // The Auth server's answer on whether this session still exists. Nothing in
  // these tests needs the network, so the answer is set per test.
  (client.auth as unknown as { getUser: (jwt: string) => Promise<unknown> }).getUser = async (
    jwt: string
  ) => {
    mocks.calls.push("live");
    return { ...mocks.liveAnswer, _jwt: jwt };
  };
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROJECT_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
  // The middleware confirmed this session for the request.
  mocks.requestHeaders = new Headers({ [AUTH_USER_HEADER]: "user-123" });
  mocks.liveAnswer = { data: { user: { id: "user-123" } }, error: null };
  mocks.calls = [];
});

describe("getRequestUser", () => {
  it("refuses a session the Auth server no longer recognises, even with a valid signature", async () => {
    // A signed-out session: the token still verifies, but the Auth server
    // answers that the session is gone. That answer decides, not the signature.
    const key = await signingKey("kid-1");
    mocks.client = clientWithToken(await signToken(key, claims()));
    mocks.liveAnswer = { data: { user: null }, error: { message: "session_not_found" } };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("jwks.json")) {
          return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${input}`);
      })
    );

    const { getRequestUser, getRequestSession, startRequestSession } = await freshSession();
    await expect(getRequestUser()).resolves.toBeNull();
    await expect(getRequestSession()).resolves.toBeNull();
    // The local check still succeeded: the pending session says it is not live.
    const pending = await startRequestSession();
    await expect(pending?.live).resolves.toBe(false);
  });

  it("refuses when the Auth server names a different user than the verified token", async () => {
    const key = await signingKey("kid-1");
    mocks.client = clientWithToken(await signToken(key, claims()));
    mocks.liveAnswer = { data: { user: { id: "someone-else" } }, error: null };

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

  it("starts the live check before the local verification finishes", async () => {
    const key = await signingKey("kid-1");
    mocks.client = clientWithToken(await signToken(key, claims()));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("jwks.json")) {
          mocks.calls.push("keys");
          return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${input}`);
      })
    );

    const { getRequestUser } = await freshSession();
    await expect(getRequestUser()).resolves.toMatchObject({ id: "user-123" });
    // The network check is issued before the key set is read, so the two run
    // together rather than one after the other.
    expect(mocks.calls.indexOf("live")).toBeGreaterThanOrEqual(0);
    expect(mocks.calls.indexOf("live")).toBeLessThan(mocks.calls.indexOf("keys"));
  });

  it("lets the caller read the profile before the revocation answer is known", async () => {
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

    const { startRequestSession } = await freshSession();
    const pending = await startRequestSession();
    // The session is available at once; only `live` waits for the Auth server.
    expect(pending?.session.user.id).toBe("user-123");
    await expect(pending?.live).resolves.toBe(true);
  });

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
    // An unknown key id makes `getClaims()` fall back to asking the Auth
    // server, which does not recognise a token it never issued.
    mocks.liveAnswer = { data: { user: null }, error: { message: "invalid JWT" } };

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

  it("refuses the session rather than hanging when the key discovery endpoint stalls", async () => {
    vi.useFakeTimers();
    // A key id no earlier test put in the SDK's own key cache, so the SDK's
    // fallback fetch runs for real in this test too.
    const key = await signingKey("kid-stalled");
    mocks.client = clientWithToken(await signToken(key, claims()));

    // Neither the app's key cache nor the SDK's own discovery can be filled:
    // every request to the endpoint stalls until its deadline aborts it.
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The request was aborted.", "AbortError"))
          );
        })
      )
    );

    const { getRequestUser } = await freshSession();
    const pending = getRequestUser();

    // Both fetches — the cache's and the SDK's own — are aborted at their
    // deadline; nothing waits for a stalled endpoint forever.
    await vi.advanceTimersByTimeAsync(2 * SIGNING_KEY_FETCH_TIMEOUT_MS);
    // An unavailable key set did not make verification succeed.
    await expect(pending).resolves.toBeNull();
  });
});
