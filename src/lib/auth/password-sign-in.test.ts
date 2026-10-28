import { describe, expect, it } from "vitest";
import {
  type AttemptGate,
  clientIpFromHeaders,
  createPasswordSignInHandler,
  decideSecondFactor,
  LOGIN_WINDOW_SECONDS,
  lockSeconds,
  passwordFailure,
  type PasswordSignInPorts,
  type SecondFactor,
  totpFailure,
} from "./password-sign-in";

const URL_UNDER_TEST = "https://project.example/functions/v1/password-sign-in";
const FACTOR_ID = "9b1f6c2e-3d4a-4b5c-8d6e-7f8a9b0c1d2e";
const NOW = new Date("2026-10-25T08:00:00.000Z");
const SESSION = { access_token: "aal1-token", refresh_token: "refresh", user: { id: "u1" } };

type Calls = string[];

/**
 * Fake ports whose calls are recorded in order. Defaults describe a successful
 * sign-in with no second factor; each test overrides only what it exercises.
 */
function fakePorts(overrides: Partial<{
  begin: AttemptGate;
  claim: "claimed" | "replayed" | "failed";
  signIn: Awaited<ReturnType<PasswordSignInPorts["auth"]["signInWithPassword"]>>;
  second: SecondFactor;
  user: Awaited<ReturnType<PasswordSignInPorts["auth"]["userFromToken"]>>;
  verify: Awaited<ReturnType<PasswordSignInPorts["auth"]["verifyTotp"]>>;
}> = {}) {
  const calls: Calls = [];
  const ports: PasswordSignInPorts = {
    now: () => NOW,
    limiter: {
      async begin(email, ip) {
        calls.push(`begin:${email}:${ip ?? ""}`);
        return overrides.begin ?? { kind: "allowed" };
      },
      async refund(email, ip) {
        calls.push(`refund:${email}:${ip ?? ""}`);
      },
      async clear(email, ip) {
        calls.push(`clear:${email}:${ip ?? ""}`);
      },
      async claimTotp(factorId, code) {
        calls.push(`claim:${factorId}:${code}`);
        return overrides.claim ?? "claimed";
      },
    },
    auth: {
      async signInWithPassword(email, password) {
        calls.push(`signIn:${email}:${password}`);
        return overrides.signIn ?? { kind: "session", session: SESSION };
      },
      async secondFactor() {
        calls.push("secondFactor");
        return overrides.second ?? { kind: "none" };
      },
      async userFromToken(token) {
        calls.push(`user:${token}`);
        return overrides.user ?? { kind: "user", email: "clinician@example.com" };
      },
      async verifyTotp(token, factorId, code) {
        calls.push(`verify:${token}:${factorId}:${code}`);
        return overrides.verify ?? { kind: "session", session: { ...SESSION, aal: "aal2" } };
      },
    },
  };
  return { ports, calls, handle: createPasswordSignInHandler(ports) };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_UNDER_TEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("clientIpFromHeaders", () => {
  it("prefers cf-connecting-ip, which the edge sets to the caller", () => {
    const headers = new Headers({ "cf-connecting-ip": "112.200.1.2", "x-forwarded-for": "112.200.1.2,112.200.1.2, 99.82.170.150" });
    expect(clientIpFromHeaders(headers)).toBe("112.200.1.2");
  });

  it("falls back to the first x-forwarded-for hop, never the rotating edge hop", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "112.200.1.2, 99.82.170.150" }))).toBe("112.200.1.2");
  });

  it("returns null when neither header is usable", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull();
    expect(clientIpFromHeaders(new Headers({ "cf-connecting-ip": " ", "x-forwarded-for": "  , " }))).toBeNull();
  });
});

describe("lockSeconds", () => {
  it("counts the remaining seconds, rounding up", () => {
    expect(lockSeconds(new Date(NOW.getTime() + 61_200), NOW)).toBe(62);
  });

  it("never exceeds the login window, even under clock skew", () => {
    expect(lockSeconds(new Date(NOW.getTime() + 3 * 60 * 60_000), NOW)).toBe(LOGIN_WINDOW_SECONDS);
  });

  it("is at least one second for a lock that is ending", () => {
    expect(lockSeconds(NOW, NOW)).toBe(1);
    expect(lockSeconds(new Date(NOW.getTime() - 5_000), NOW)).toBe(1);
  });
});

describe("decideSecondFactor", () => {
  const verifiedTotp = { totp: [{ id: FACTOR_ID, factor_type: "totp", status: "verified" }] };

  it("requires TOTP only for aal1 with a next level of aal2", () => {
    expect(decideSecondFactor({ currentLevel: "aal1", nextLevel: "aal2" }, verifiedTotp, false))
      .toEqual({ kind: "totp", factorId: FACTOR_ID });
  });

  it("is none when no second factor is pending", () => {
    expect(decideSecondFactor({ currentLevel: "aal1", nextLevel: "aal1" }, verifiedTotp, false))
      .toEqual({ kind: "none" });
  });

  it("fails closed when AAL, factors or the verified factor are missing", () => {
    expect(decideSecondFactor(null, verifiedTotp, false)).toEqual({ kind: "unavailable" });
    expect(decideSecondFactor({ currentLevel: "aal1", nextLevel: "aal2" }, null, true))
      .toEqual({ kind: "unavailable" });
    expect(decideSecondFactor({ currentLevel: "aal1", nextLevel: "aal2" }, { totp: [] }, false))
      .toEqual({ kind: "unavailable" });
  });
});

describe("failure mapping", () => {
  it("never reports a network or server error as wrong credentials", () => {
    expect(passwordFailure({}).status).toBe(503);
    expect(passwordFailure({ status: 500 })).toMatchObject({ status: 503, body: { code: "auth_unavailable" } });
    expect(passwordFailure({ status: 400, code: "invalid_credentials" })).toMatchObject({
      status: 400,
      body: { code: "invalid_credentials" },
    });
  });

  it("separates confirmation, deactivation and GoTrue's own rate limit", () => {
    expect(passwordFailure({ code: "email_not_confirmed", status: 400 }).body).toEqual({ code: "email_unconfirmed" });
    expect(passwordFailure({ code: "user_banned", status: 403 }).body).toEqual({ code: "account_deactivated" });
    expect(passwordFailure({ status: 429 })).toMatchObject({ status: 429, body: { code: "auth_rate_limited" } });
  });

  it("maps a challenge 4xx to invalid_factor and a verify 4xx to invalid_totp", () => {
    expect(totpFailure("challenge", { status: 404 }).body).toEqual({ code: "invalid_factor" });
    expect(totpFailure("verify", { status: 400 }).body).toEqual({ code: "invalid_totp" });
    expect(totpFailure("verify", { status: 401 }).body).toEqual({ code: "unauthorized" });
    expect(totpFailure("verify", {}).status).toBe(503);
  });
});

describe("request validation", () => {
  it("rejects malformed bodies before touching the limiter", async () => {
    const cases = [
      post("not json"),
      post([1, 2]),
      post({ action: "reset" }),
      post({ action: "password", email: "", password: "x" }),
      post({ action: "password", email: "a@b.c" }),
      post({ action: "totp", factor_id: "not-a-uuid", code: "123456" }),
      post({ action: "totp", factor_id: FACTOR_ID, code: "12345" }),
    ];
    for (const request of cases) {
      const { handle, calls } = fakePorts();
      const response = await handle(request);
      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({ code: "invalid_request" });
      expect(calls).toEqual([]);
    }
  });

  it("answers OPTIONS with CORS and refuses other methods with Allow", async () => {
    const { handle, calls } = fakePorts();
    const options = await handle(new Request(URL_UNDER_TEST, { method: "OPTIONS" }));
    expect(options.status).toBe(200);
    expect(options.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    const get = await handle(new Request(URL_UNDER_TEST, { method: "GET" }));
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST, OPTIONS");
    expect(calls).toEqual([]);
  });
});

describe("password action", () => {
  it("counts the attempt before the password is checked, then fails with generic credentials", async () => {
    const { handle, calls } = fakePorts({
      signIn: { kind: "error", status: 400, code: "invalid_credentials" },
    });
    const response = await handle(post({ action: "password", email: " Clinician@Example.com ", password: "hunter2-wrong" }));
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ code: "invalid_credentials" });
    expect(calls).toEqual([
      "begin:Clinician@Example.com:",
      "signIn:Clinician@Example.com:hunter2-wrong",
    ]);
  });

  it("does not echo the password or any token in a failure body", async () => {
    const { handle } = fakePorts({ signIn: { kind: "error", status: 400, code: "invalid_credentials" } });
    const response = await handle(post({ action: "password", email: "a@b.c", password: "s3cret-pass" }));
    expect(await response.text()).not.toContain("s3cret-pass");
  });

  it("fails closed without checking the password when the limiter errors", async () => {
    const { handle, calls } = fakePorts({ begin: { kind: "failed" } });
    const response = await handle(post({ action: "password", email: "a@b.c", password: "pw" }));
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({ code: "limiter_unavailable" });
    expect(calls).toEqual(["begin:a@b.c:"]);
  });

  it("refuses a locked account with remaining seconds and a Retry-After header, without checking the password", async () => {
    const { handle, calls } = fakePorts({
      begin: { kind: "locked", retryAfter: new Date(NOW.getTime() + 120_000) },
    });
    const response = await handle(post({ action: "password", email: "a@b.c", password: "pw" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(await json(response)).toEqual({ code: "login_locked", retry_after_seconds: 120 });
    expect(calls).toEqual(["begin:a@b.c:"]);
  });

  it("clears the counter on a completed sign-in without a second factor", async () => {
    const { handle, calls } = fakePorts();
    const response = await handle(post({ action: "password", email: "a@b.c", password: "pw" }, { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9, 99.82.170.150" }));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ mfa_required: false, session: SESSION });
    expect(calls).toEqual([
      "begin:a@b.c:203.0.113.9",
      "signIn:a@b.c:pw",
      "secondFactor",
      "clear:a@b.c:203.0.113.9",
    ]);
  });

  it("refunds the attempt and returns the aal1 session when TOTP is required", async () => {
    const { handle, calls } = fakePorts({ second: { kind: "totp", factorId: FACTOR_ID } });
    const response = await handle(post({ action: "password", email: "a@b.c", password: "pw" }));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ mfa_required: true, factor_id: FACTOR_ID, session: SESSION });
    expect(calls).toContain(`refund:a@b.c:`);
    expect(calls.some((call) => call.startsWith("clear:"))).toBe(false);
  });

  it("does not hand out a session when the second-factor state cannot be read", async () => {
    const { handle, calls } = fakePorts({ second: { kind: "unavailable" } });
    const response = await handle(post({ action: "password", email: "a@b.c", password: "pw" }));
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({ code: "mfa_unavailable" });
    expect(calls.some((call) => call.startsWith("refund:") || call.startsWith("clear:"))).toBe(false);
  });

  it("keeps the attempt counted for unconfirmed and banned accounts", async () => {
    const { handle, calls } = fakePorts({ signIn: { kind: "error", status: 403, code: "user_banned" } });
    const response = await handle(post({ action: "password", email: "a@b.c", password: "pw" }));
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ code: "account_deactivated" });
    expect(calls.some((call) => call.startsWith("clear:"))).toBe(false);
  });
});

describe("totp action", () => {
  const body = { action: "totp", factor_id: FACTOR_ID, code: "123 456" };
  const bearer = { authorization: "Bearer aal1-token" };

  it("requires a bearer token before any limiter work", async () => {
    const { handle, calls } = fakePorts();
    const response = await handle(post(body));
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("uses the token's email, ignoring any email in the body, and counts before claiming", async () => {
    const { handle, calls } = fakePorts();
    const response = await handle(post({ ...body, email: "someone-else@example.com" }, bearer));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ mfa_required: false, session: { ...SESSION, aal: "aal2" } });
    expect(calls).toEqual([
      "user:aal1-token",
      `begin:clinician@example.com:`,
      `claim:${FACTOR_ID}:123456`,
      `verify:aal1-token:${FACTOR_ID}:123456`,
      "clear:clinician@example.com:",
    ]);
  });

  it("refuses a locked account before the code is checked", async () => {
    const { handle, calls } = fakePorts({ begin: { kind: "locked", retryAfter: new Date(NOW.getTime() + 900_000) } });
    const response = await handle(post(body, bearer));
    expect(response.status).toBe(429);
    expect(await json(response)).toEqual({ code: "login_locked", retry_after_seconds: 900 });
    expect(calls).toEqual(["user:aal1-token", "begin:clinician@example.com:"]);
  });

  it("refuses a reused code without asking GoTrue to verify it", async () => {
    const { handle, calls } = fakePorts({ claim: "replayed" });
    const response = await handle(post(body, bearer));
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ code: "totp_reused" });
    expect(calls.some((call) => call.startsWith("verify:"))).toBe(false);
  });

  it("fails closed when the replay check cannot run", async () => {
    const { handle, calls } = fakePorts({ claim: "failed" });
    const response = await handle(post(body, bearer));
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({ code: "limiter_unavailable" });
    expect(calls.some((call) => call.startsWith("verify:"))).toBe(false);
  });

  it("keeps a wrong code counted and returns no session", async () => {
    const { handle, calls } = fakePorts({ verify: { kind: "error", step: "verify", status: 400 } });
    const response = await handle(post(body, bearer));
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ code: "invalid_totp" });
    expect(calls.some((call) => call.startsWith("clear:"))).toBe(false);
  });

  it("refuses a factor the token's user does not own", async () => {
    const { handle } = fakePorts({ verify: { kind: "error", step: "challenge", status: 404 } });
    const response = await handle(post(body, bearer));
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ code: "invalid_factor" });
  });

  it("returns 401 when the token no longer resolves to a user", async () => {
    const { handle, calls } = fakePorts({ user: { kind: "unauthorized" } });
    const response = await handle(post(body, bearer));
    expect(response.status).toBe(401);
    expect(calls).toEqual(["user:aal1-token"]);
  });
});
