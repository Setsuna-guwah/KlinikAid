/**
 * Password sign-in behind the shared attempt limiter (#70).
 *
 * Mobile signs in through the `password-sign-in` Edge function because Supabase
 * Auth cannot call this limiter itself on the free plan, so a direct
 * `signInWithPassword` would bypass it. The ordering here mirrors web's
 * loginAction in src/app/(auth)/login/actions.ts: count the attempt before the
 * password is checked, refund it when the password was right but a code is
 * still needed, clear it on a completed sign-in, and claim each TOTP code once.
 *
 * Runtime-neutral on purpose: no imports beyond the MFA helper, so the same
 * code runs under Vitest (CI) and Deno (supabase/functions/password-sign-in).
 * Ports are injected so the ordering can be tested without a database.
 *
 * Response contract: supabase/functions/password-sign-in/README.md.
 */
import { getTotpFactors } from "@/lib/auth/mfa";

/** Mirrors LOGIN_WINDOW_MINUTES in src/lib/auth/login-attempts.ts (15 min). */
export const LOGIN_WINDOW_SECONDS = 15 * 60;

const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOTP_CODE_PATTERN = /^\d{6}$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** An error from GoTrue or supabase-js. `status` is missing on network failures. */
export type AuthFailure = { status?: number; code?: string };

export type AttemptGate =
  | { kind: "allowed" }
  | { kind: "locked"; retryAfter: Date }
  | { kind: "failed" };

export type TotpClaim = "claimed" | "replayed" | "failed";

export type PasswordResult =
  | { kind: "session"; session: unknown }
  | ({ kind: "error" } & AuthFailure);

export type TokenUser =
  | { kind: "user"; email: string }
  | { kind: "unauthorized" }
  | { kind: "unavailable" };

export type TotpVerify =
  | { kind: "session"; session: unknown }
  | ({ kind: "error"; step: "challenge" | "verify" } & AuthFailure);

export type SecondFactor =
  | { kind: "none" }
  | { kind: "totp"; factorId: string }
  | { kind: "unavailable" };

export interface PasswordSignInPorts {
  now(): Date;
  limiter: {
    begin(email: string, ip: string | null): Promise<AttemptGate>;
    refund(email: string, ip: string | null): Promise<void>;
    clear(email: string, ip: string | null): Promise<void>;
    claimTotp(factorId: string, code: string): Promise<TotpClaim>;
  };
  auth: {
    signInWithPassword(email: string, password: string): Promise<PasswordResult>;
    /** Reads the session's assurance level and, when TOTP is pending, its factor. */
    secondFactor(session: unknown): Promise<SecondFactor>;
    /** Resolves the caller from its access token. The email comes from here, never the body. */
    userFromToken(accessToken: string): Promise<TokenUser>;
    /** Challenges and verifies `factorId` as the token's user. */
    verifyTotp(accessToken: string, factorId: string, code: string): Promise<TotpVerify>;
  };
}

export type Reply = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

/**
 * Client IP for the limiter key.
 *
 * Observed on production (2026-10-25): the Supabase edge sets
 * `cf-connecting-ip` to the caller's address and rewrites `x-forwarded-for` to
 * `<client>, <client>, <edge>`, discarding any value the client sent. The last
 * hop is a rotating edge address (a fresh bucket per request, so the limit
 * never trips), so it must not be used. Prefer `cf-connecting-ip`; fall back to
 * the first `x-forwarded-for` hop, which the edge also sets to the client.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const connecting = headers.get("cf-connecting-ip")?.trim();
  if (connecting) return connecting;
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first : null;
}

/** Seconds until a lock ends, clamped to [1, LOGIN_WINDOW_SECONDS]. */
export function lockSeconds(retryAfter: Date, now: Date): number {
  const remaining = Math.ceil((retryAfter.getTime() - now.getTime()) / 1000);
  return Math.min(LOGIN_WINDOW_SECONDS, Math.max(1, remaining));
}

/**
 * Mirrors the second-factor branch of web's loginAction. A completed password
 * sign-in still needs TOTP only when next AAL is aal2 and the session is aal1.
 * Any lookup failure, or no verified TOTP factor, is unavailable: fail closed.
 */
export function decideSecondFactor(
  aal: { currentLevel?: string | null; nextLevel?: string | null } | null,
  factors: Parameters<typeof getTotpFactors>[0],
  factorsFailed: boolean,
): SecondFactor {
  if (!aal) return { kind: "unavailable" };
  if (!(aal.nextLevel === "aal2" && aal.currentLevel === "aal1")) return { kind: "none" };
  if (factorsFailed || !factors) return { kind: "unavailable" };
  const totp = getTotpFactors(factors).find((factor) => factor.status === "verified");
  return totp ? { kind: "totp", factorId: totp.id } : { kind: "unavailable" };
}

/** Maps a failed password grant. Only credentials errors reach the caller as wrong credentials. */
export function passwordFailure(failure: AuthFailure): Reply {
  if (failure.code === "user_banned") return reply(403, { code: "account_deactivated" });
  if (failure.code === "email_not_confirmed") return reply(403, { code: "email_unconfirmed" });
  if (failure.status === 429) return reply(429, { code: "auth_rate_limited" });
  if (isUnavailable(failure)) return reply(503, { code: "auth_unavailable" });
  return reply(400, { code: "invalid_credentials" });
}

/** Maps a failed TOTP challenge or verify. A 4xx on challenge means the factor is not the caller's. */
export function totpFailure(step: "challenge" | "verify", failure: AuthFailure): Reply {
  if (failure.code === "user_banned") return reply(403, { code: "account_deactivated" });
  if (failure.status === 429) return reply(429, { code: "auth_rate_limited" });
  if (failure.status === 401) return reply(401, { code: "unauthorized" });
  if (isUnavailable(failure)) return reply(503, { code: "auth_unavailable" });
  return reply(400, { code: step === "challenge" ? "invalid_factor" : "invalid_totp" });
}

export function createPasswordSignInHandler(ports: PasswordSignInPorts) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (req.method !== "POST") {
      return toResponse(reply(405, { code: "method_not_allowed" }, { Allow: "POST, OPTIONS" }));
    }
    return toResponse(await handle(req, ports));
  };
}

async function handle(req: Request, ports: PasswordSignInPorts): Promise<Reply> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidRequest();
  }
  if (!isRecord(body)) return invalidRequest();
  if (body.action === "password") return passwordStep(req, body, ports);
  if (body.action === "totp") return totpStep(req, body, ports);
  return invalidRequest();
}

async function passwordStep(
  req: Request,
  body: Record<string, unknown>,
  ports: PasswordSignInPorts,
): Promise<Reply> {
  const email = emailField(body.email);
  const password = passwordField(body.password);
  if (!email || !password) return invalidRequest();
  const ip = clientIpFromHeaders(req.headers);

  // Counted before the password is checked, as web does.
  const refused = await gate(ports, email, ip);
  if (refused) return refused;

  const result = await ports.auth.signInWithPassword(email, password);
  if (result.kind === "error") return passwordFailure(result);

  const second = await ports.auth.secondFactor(result.session);
  if (second.kind === "unavailable") return reply(503, { code: "mfa_unavailable" });
  if (second.kind === "totp") {
    // The password was right and the user is only being asked for a code, so
    // this submission should not use up an attempt. Best effort, like web.
    await ports.limiter.refund(email, ip);
    return reply(200, {
      mfa_required: true,
      factor_id: second.factorId,
      session: result.session,
    });
  }
  await ports.limiter.clear(email, ip);
  return reply(200, { mfa_required: false, session: result.session });
}

async function totpStep(
  req: Request,
  body: Record<string, unknown>,
  ports: PasswordSignInPorts,
): Promise<Reply> {
  const factorId = typeof body.factor_id === "string" && UUID_PATTERN.test(body.factor_id)
    ? body.factor_id
    : null;
  const code = totpCodeField(body.code);
  if (!factorId || !code) return invalidRequest();

  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return reply(401, { code: "unauthorized" });
  const user = await ports.auth.userFromToken(token);
  if (user.kind === "unavailable") return reply(503, { code: "auth_unavailable" });
  if (user.kind === "unauthorized") return reply(401, { code: "unauthorized" });

  // Counted against the same (email, ip) limit as the password step.
  const ip = clientIpFromHeaders(req.headers);
  const refused = await gate(ports, user.email, ip);
  if (refused) return refused;

  // Claim before verify, as the #70 contract orders it. Replays never reach GoTrue.
  const claim = await ports.limiter.claimTotp(factorId, code);
  if (claim === "failed") return reply(503, { code: "limiter_unavailable" });
  if (claim === "replayed") return reply(400, { code: "totp_reused" });

  const verified = await ports.auth.verifyTotp(token, factorId, code);
  if (verified.kind === "error") return totpFailure(verified.step, verified);

  await ports.limiter.clear(user.email, ip);
  return reply(200, { mfa_required: false, session: verified.session });
}

async function gate(
  ports: PasswordSignInPorts,
  email: string,
  ip: string | null,
): Promise<Reply | null> {
  const attempt = await ports.limiter.begin(email, ip);
  if (attempt.kind === "failed") return reply(503, { code: "limiter_unavailable" });
  if (attempt.kind === "locked") {
    const seconds = lockSeconds(attempt.retryAfter, ports.now());
    return reply(
      429,
      { code: "login_locked", retry_after_seconds: seconds },
      { "Retry-After": String(seconds) },
    );
  }
  return null;
}

function reply(status: number, body: Record<string, unknown>, headers?: Record<string, string>): Reply {
  return { status, body, headers };
}

function invalidRequest(): Reply {
  return reply(400, { code: "invalid_request" });
}

function toResponse(result: Reply): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...result.headers },
  });
}

function isUnavailable(failure: AuthFailure): boolean {
  return !failure.status || failure.status >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emailField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_EMAIL_LENGTH ? trimmed : null;
}

function passwordField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_PASSWORD_LENGTH
    ? value
    : null;
}

/** Whitespace is stripped, as web does, before the six-digit shape is checked. */
function totpCodeField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, "");
  return TOTP_CODE_PATTERN.test(compact) ? compact : null;
}

function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/.exec(header ?? "");
  return match ? match[1] : null;
}
