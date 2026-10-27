import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * The signing-key cache shared by the middleware and the server code (#238).
 *
 * Both key-set fetches — ours, and the one `getClaims()` issues itself when
 * the keys passed in cannot verify the token — run under one deadline, so a
 * stalled discovery endpoint can never hold a request open. An unavailable
 * key set must never make verification succeed: the callers fall back to the
 * Auth server's own verification or refuse the session, which the test
 * against the real Supabase client proves.
 */

const PROJECT_URL = "https://project.supabase.co";
const ANON_KEY = "anon-key";
const JWKS_URL = `${PROJECT_URL}/auth/v1/.well-known/jwks.json`;
const OTHER_URL = `${PROJECT_URL}/rest/v1/patients`;

/**
 * A fetch that never answers until its request is aborted, the way a stalled
 * endpoint behaves. Calls without a signal never settle, so a test that
 * forgets the deadline hangs instead of passing.
 */
function fetchThatStalls() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("The request was aborted.", "AbortError"))
      );
    })
  );
}

/**
 * Headers at once, a JSON body that never finishes: the stall after the
 * headers, where the response has arrived but `response.json()` would wait
 * forever without the deadline.
 */
function fetchWhoseBodyStalls() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"keys":[{"kty":"EC",'));
        init?.signal?.addEventListener("abort", () =>
          controller.error(new DOMException("The request was aborted.", "AbortError"))
        );
        // never closed: the JSON body never completes
      },
    });
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "content-type": "application/json" } })
    );
  });
}

function fetchAnswering(body: unknown, status = 200) {
  return vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status })
  );
}

function keySet(kid: string) {
  return { keys: [{ kty: "EC", kid, alg: "ES256", use: "sig", key_ops: ["verify"] }] };
}

/**
 * A fresh copy of the module, so its cache of signing keys starts empty in
 * every test.
 */
async function freshSigningKeys() {
  vi.resetModules();
  return import("./signing-keys");
}

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROJECT_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
});

describe("fetchWithSigningKeyDeadline", () => {
  it("sends every other request unchanged", async () => {
    const fetchMock = fetchAnswering({});
    vi.stubGlobal("fetch", fetchMock);

    const { fetchWithSigningKeyDeadline } = await freshSigningKeys();
    const init = { headers: { apikey: ANON_KEY } };
    await fetchWithSigningKeyDeadline(OTHER_URL, init);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(OTHER_URL);
    // The init was passed straight through: no deadline signal was added.
    expect(fetchMock.mock.calls[0][1]).toBe(init);
  });

  it("aborts a stalled discovery request at the deadline", async () => {
    vi.useFakeTimers();
    const stalled = fetchThatStalls();
    vi.stubGlobal("fetch", stalled);

    const { fetchWithSigningKeyDeadline, SIGNING_KEY_FETCH_TIMEOUT_MS } =
      await freshSigningKeys();
    const pending = fetchWithSigningKeyDeadline(JWKS_URL, { headers: { apikey: ANON_KEY } });
    // Guarded from the start, the way a caller's catch would receive it.
    const failure = pending.catch((error: unknown) => error);

    // The discovery request carries a deadline signal.
    expect(stalled.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

    await vi.advanceTimersByTimeAsync(SIGNING_KEY_FETCH_TIMEOUT_MS);
    await expect(failure).resolves.toMatchObject({ name: "AbortError" });
  });

  it("recognises a discovery request given as a Request object", async () => {
    vi.useFakeTimers();
    const stalled = fetchThatStalls();
    vi.stubGlobal("fetch", stalled);

    const { fetchWithSigningKeyDeadline, SIGNING_KEY_FETCH_TIMEOUT_MS } =
      await freshSigningKeys();
    const pending = fetchWithSigningKeyDeadline(new Request(JWKS_URL));
    const failure = pending.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(SIGNING_KEY_FETCH_TIMEOUT_MS);
    await expect(failure).resolves.toMatchObject({ name: "AbortError" });
  });

  it("still applies a signal the caller brought", async () => {
    const stalled = fetchThatStalls();
    vi.stubGlobal("fetch", stalled);

    const { fetchWithSigningKeyDeadline } = await freshSigningKeys();
    const caller = new AbortController();
    const pending = fetchWithSigningKeyDeadline(JWKS_URL, { signal: caller.signal });

    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("getSigningKeys", () => {
  it("keeps the keys it already knows when a refresh stalls past its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchAnswering(keySet("kid-1")));

    const fresh = await freshSigningKeys();
    await expect(fresh.getSigningKeys()).resolves.toMatchObject([{ kid: "kid-1" }]);

    // The cached set goes stale, and the next discovery request stalls.
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    const stalled = fetchThatStalls();
    vi.stubGlobal("fetch", stalled);

    const pending = fresh.getSigningKeys();
    await vi.advanceTimersByTimeAsync(fresh.SIGNING_KEY_FETCH_TIMEOUT_MS);

    // The stalled fetch was aborted at its deadline, not awaited forever,
    // and the keys already known still serve the caller.
    await expect(pending).resolves.toMatchObject([{ kid: "kid-1" }]);
    expect(stalled.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("keeps the keys it already knows when a response body stalls past its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchAnswering(keySet("kid-1")));

    const fresh = await freshSigningKeys();
    await expect(fresh.getSigningKeys()).resolves.toMatchObject([{ kid: "kid-1" }]);

    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    const stallingBody = fetchWhoseBodyStalls();
    vi.stubGlobal("fetch", stallingBody);

    const pending = fresh.getSigningKeys();
    await vi.advanceTimersByTimeAsync(fresh.SIGNING_KEY_FETCH_TIMEOUT_MS);

    // The headers arrived, the body never did: the deadline aborted the read
    // all the same, and the keys already known still serve the caller.
    await expect(pending).resolves.toMatchObject([{ kid: "kid-1" }]);
    expect(stallingBody.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("answers a cold start with no keys rather than hanging", async () => {
    vi.useFakeTimers();
    const stalled = fetchThatStalls();
    vi.stubGlobal("fetch", stalled);

    const fresh = await freshSigningKeys();
    const pending = fresh.getSigningKeys();

    // Bounded: the caller gets an empty key set once the deadline passes, and
    // `getClaims()` falls back to the Auth server's own verification.
    await vi.advanceTimersByTimeAsync(fresh.SIGNING_KEY_FETCH_TIMEOUT_MS);
    await expect(pending).resolves.toEqual([]);
  });

  it("does not remember a failed fetch as a fresh key set", async () => {
    vi.stubGlobal("fetch", fetchAnswering("gone", 500));

    const fresh = await freshSigningKeys();
    await expect(fresh.getSigningKeys()).resolves.toEqual([]);

    // The endpoint is tried again on the next request instead of serving the
    // failure — or an empty set — from the cache.
    const answering = fetchAnswering(keySet("kid-2"));
    vi.stubGlobal("fetch", answering);
    await expect(fresh.getSigningKeys()).resolves.toMatchObject([{ kid: "kid-2" }]);
    expect(answering).toHaveBeenCalledTimes(1);
  });
});

describe("the Supabase client's own key discovery", () => {
  it("refuses the token when the SDK's own stalled discovery request is aborted: fail closed", async () => {
    vi.useFakeTimers();
    const stalled = fetchThatStalls();
    vi.stubGlobal("fetch", stalled);

    const { fetchWithSigningKeyDeadline, SIGNING_KEY_FETCH_TIMEOUT_MS } =
      await freshSigningKeys();

    // Built as src/lib/supabase/server.ts builds it.
    (globalThis as { WebSocket?: unknown }).WebSocket = class NoopWebSocket {};
    const client = createClient(PROJECT_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchWithSigningKeyDeadline },
    });

    // A token whose key the empty key set cannot verify: the SDK fetches the
    // key set itself, and that request stalls too.
    const token = await signTokenWithKid("kid-1");
    const result = client.auth.getClaims(token, { jwks: { keys: [] } });

    await vi.advanceTimersByTimeAsync(SIGNING_KEY_FETCH_TIMEOUT_MS);
    const { data, error } = await result;

    // The SDK's own fetch was the one that stalled, under the same deadline.
    expect(stalled).toHaveBeenCalledTimes(1);
    expect(String(stalled.mock.calls[0][0])).toContain(".well-known/jwks.json");
    // An unavailable key set did not make verification succeed.
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("refuses the token when the SDK's own discovery response body stalls: fail closed", async () => {
    vi.useFakeTimers();
    const stallingBody = fetchWhoseBodyStalls();
    vi.stubGlobal("fetch", stallingBody);

    const { fetchWithSigningKeyDeadline, SIGNING_KEY_FETCH_TIMEOUT_MS } =
      await freshSigningKeys();

    (globalThis as { WebSocket?: unknown }).WebSocket = class NoopWebSocket {};
    const client = createClient(PROJECT_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchWithSigningKeyDeadline },
    });

    const token = await signTokenWithKid("kid-body");
    const result = client.auth.getClaims(token, { jwks: { keys: [] } });

    await vi.advanceTimersByTimeAsync(SIGNING_KEY_FETCH_TIMEOUT_MS);
    const { data, error } = await result;

    // The headers arrived at once; the body read inside the SDK was aborted
    // at the deadline, and verification failed closed.
    expect(stallingBody).toHaveBeenCalledTimes(1);
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});

function base64url(bytes: Uint8Array | string): string {
  const buffer = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return Buffer.from(buffer).toString("base64url");
}

// The same WebCrypto implementation the Auth client verifies with.
const subtle = globalThis.crypto.subtle;

/** A real ES256 token, so the SDK path under test runs for real. */
async function signTokenWithKid(kid: string): Promise<string> {
  const pair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: `${PROJECT_URL}/auth/v1`,
    sub: "user-123",
    aud: "authenticated",
    role: "authenticated",
    iat: now,
    exp: now + 3600,
  };
  const header = { alg: "ES256", kid, typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claims)
  )}`;
  const signature = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
