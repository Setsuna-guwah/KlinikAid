/**
 * Supabase Edge Function: password-sign-in (#70)
 * Runtime: Deno. Caller: the mobile app, before a session exists (verify_jwt=false).
 *
 * The ordering, limits and response contract live in
 * src/lib/auth/password-sign-in.ts, which is unit-tested under Vitest in CI.
 * This file only binds real Supabase clients to those ports.
 *
 * Contract and deploy notes: ./README.md. Not deployed by this PR.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type AttemptGate,
  createPasswordSignInHandler,
  decideSecondFactor,
  type PasswordSignInPorts,
  type TotpClaim,
  type TotpVerify,
} from "@/lib/auth/password-sign-in";

const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

Deno.serve(async (req: Request): Promise<Response> => {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    // Fail closed: without the limiter's client, no password is checked.
    return new Response(JSON.stringify({ code: "auth_unavailable" }), {
      status: 503,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
    });
  }
  // One pair of clients per request: the anon client holds the sign-in session.
  const anon = createClient(url, anonKey, CLIENT_OPTIONS);
  const admin = createClient(url, serviceKey, CLIENT_OPTIONS);
  return createPasswordSignInHandler(ports(url, anonKey, anon, admin))(req);
});

function ports(
  url: string,
  anonKey: string,
  anon: SupabaseClient,
  admin: SupabaseClient,
): PasswordSignInPorts {
  async function callVoid(fn: string, email: string, ip: string | null): Promise<void> {
    try {
      const { error } = await admin.rpc(fn, { p_email: email, p_ip: ip ?? "" });
      if (error) console.error(`password-sign-in: ${fn} failed`);
    } catch {
      console.error(`password-sign-in: ${fn} threw`);
    }
  }

  return {
    now: () => new Date(),
    limiter: {
      async begin(email: string, ip: string | null): Promise<AttemptGate> {
        try {
          const { data, error } = await admin
            .rpc("begin_login_attempt", { p_email: email, p_ip: ip ?? "" })
            .single();
          if (error || !data) {
            console.error("password-sign-in: begin_login_attempt failed");
            return { kind: "failed" };
          }
          if (data.allowed) return { kind: "allowed" };
          const retryAfter = new Date(data.retry_after);
          if (!data.retry_after || Number.isNaN(retryAfter.getTime())) return { kind: "failed" };
          return { kind: "locked", retryAfter };
        } catch {
          console.error("password-sign-in: begin_login_attempt threw");
          return { kind: "failed" };
        }
      },
      refund: (email, ip) => callVoid("refund_login_attempt", email, ip),
      clear: (email, ip) => callVoid("clear_login_attempts", email, ip),
      async claimTotp(factorId: string, code: string): Promise<TotpClaim> {
        try {
          // The code itself is never logged.
          const { data, error } = await admin.rpc("claim_totp_code", {
            p_factor_id: factorId,
            p_code: code,
          });
          if (error || typeof data !== "boolean") {
            console.error("password-sign-in: claim_totp_code failed");
            return "failed";
          }
          return data ? "claimed" : "replayed";
        } catch {
          console.error("password-sign-in: claim_totp_code threw");
          return "failed";
        }
      },
    },
    auth: {
      async signInWithPassword(email: string, password: string) {
        try {
          const { data, error } = await anon.auth.signInWithPassword({ email, password });
          if (error) return { kind: "error", status: error.status, code: error.code };
          if (!data?.session) return { kind: "error" };
          return { kind: "session", session: data.session };
        } catch {
          return { kind: "error" };
        }
      },
      // Reads the in-memory session created by signInWithPassword on `anon`.
      async secondFactor() {
        try {
          const aal = await anon.auth.mfa.getAuthenticatorAssuranceLevel();
          if (aal.error || !aal.data) return { kind: "unavailable" };
          const factors = await anon.auth.mfa.listFactors();
          return decideSecondFactor(aal.data, factors.data, factors.error !== null);
        } catch {
          return { kind: "unavailable" };
        }
      },
      async userFromToken(accessToken: string) {
        try {
          const { data, error } = await anon.auth.getUser(accessToken);
          if (error) {
            return error.status === 400 || error.status === 401 || error.status === 403
              ? { kind: "unauthorized" }
              : { kind: "unavailable" };
          }
          return data?.user?.email
            ? { kind: "user", email: data.user.email }
            : { kind: "unauthorized" };
        } catch {
          return { kind: "unavailable" };
        }
      },
      // Raw GoTrue calls with the caller's token, as the #70 contract requires.
      // supabase-js needs a stored session for mfa.* calls, which this stateless
      // function does not have. Paths follow @supabase/auth-js GoTrueMFAApi.
      async verifyTotp(accessToken: string, factorId: string, code: string): Promise<TotpVerify> {
        const base = `${url}/auth/v1/factors/${factorId}`;
        const headers = {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        };
        try {
          const challenge = await fetch(`${base}/challenge`, { method: "POST", headers, body: "{}" });
          if (!challenge.ok) {
            return { kind: "error", step: "challenge", ...(await goTrueFailure(challenge)) };
          }
          const { id: challengeId } = (await challenge.json()) as { id?: string };
          if (!challengeId) return { kind: "error", step: "challenge" };

          const verify = await fetch(`${base}/verify`, {
            method: "POST",
            headers,
            body: JSON.stringify({ challenge_id: challengeId, code }),
          });
          if (!verify.ok) {
            return { kind: "error", step: "verify", ...(await goTrueFailure(verify)) };
          }
          return { kind: "session", session: await verify.json() };
        } catch {
          return { kind: "error", step: "verify" };
        }
      },
    },
  };
}

/** Status and error_code only. The message and any submitted value are dropped. */
async function goTrueFailure(res: Response): Promise<{ status: number; code?: string }> {
  try {
    const body = (await res.json()) as { error_code?: unknown };
    return {
      status: res.status,
      code: typeof body.error_code === "string" ? body.error_code : undefined,
    };
  } catch {
    return { status: res.status };
  }
}
