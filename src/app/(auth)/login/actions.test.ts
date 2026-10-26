import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginAction } from "./actions";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  after: vi.fn(),
  logEvent: vi.fn(),
  getDefaultLandingPath: vi.fn(),
  beginLoginAttempt: vi.fn(),
  claimTotpCode: vi.fn(),
  clearLoginAttempts: vi.fn(),
  refundLoginAttempt: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: () => mocks.createClient() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
vi.mock("next/server", () => ({ after: (task: () => unknown) => mocks.after(task) }));
vi.mock("@/lib/logger", () => ({ logEvent: (...args: unknown[]) => mocks.logEvent(...args) }));
vi.mock("@/lib/auth/helpers", () => ({
  getDefaultLandingPath: (...args: unknown[]) => mocks.getDefaultLandingPath(...args),
}));
vi.mock("@/lib/auth/email-confirmation", () => ({ sendEmailConfirmation: vi.fn() }));
vi.mock("@/lib/auth/login-attempts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/login-attempts")>()),
  beginLoginAttempt: (...args: unknown[]) => mocks.beginLoginAttempt(...args),
  claimTotpCode: (...args: unknown[]) => mocks.claimTotpCode(...args),
  clearLoginAttempts: (...args: unknown[]) => mocks.clearLoginAttempts(...args),
  refundLoginAttempt: (...args: unknown[]) => mocks.refundLoginAttempt(...args),
}));

const EMAIL = "ada@example.test";
const PASSWORD = "correct horse battery staple";
const IP = "203.0.113.7";
const TOTP_FACTOR = { id: "factor-1", factor_type: "totp", status: "verified" };

type Supabase = ReturnType<typeof makeSupabase>;

function makeSupabase() {
  const single = vi.fn();
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  return {
    from: vi.fn(() => ({ select })),
    single,
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(async () => ({ error: null })),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(),
        listFactors: vi.fn(),
        challenge: vi.fn(),
        verify: vi.fn(),
      },
    },
  };
}

/** A staff account with TOTP enrolled, every step succeeding. */
function enrolledAccount(supabase: Supabase) {
  supabase.auth.signInWithPassword.mockResolvedValue({
    data: { user: { id: "user-1", app_metadata: {} } },
    error: null,
  });
  supabase.single.mockResolvedValue({
    data: { is_active: true, role: "admin", department: null, full_name: "Ada" },
    error: null,
  });
  supabase.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: "aal1", nextLevel: "aal2" },
    error: null,
  });
  supabase.auth.mfa.listFactors.mockResolvedValue({
    data: { all: [TOTP_FACTOR], totp: [TOTP_FACTOR], phone: [], webauthn: [] },
    error: null,
  });
  supabase.auth.mfa.challenge.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
  supabase.auth.mfa.verify.mockResolvedValue({ data: {}, error: null });
}

function form(totpCode?: string): FormData {
  const data = new FormData();
  data.append("email", EMAIL);
  data.append("password", PASSWORD);
  if (totpCode !== undefined) data.append("totpCode", totpCode);
  return data;
}

/** Runs what the action handed to after(), as the server does once the reply is sent. */
async function runScheduled() {
  for (const [task] of mocks.after.mock.calls) {
    await (task as () => Promise<void>)();
  }
}

function loggedTypes(): string[] {
  return mocks.logEvent.mock.calls.map((call) => call[2] as string);
}

describe("loginAction", () => {
  let supabase: Supabase;

  beforeEach(() => {
    vi.restoreAllMocks();
    supabase = makeSupabase();
    mocks.createClient.mockReset().mockResolvedValue(supabase);
    mocks.after.mockReset();
    mocks.logEvent.mockReset().mockResolvedValue({ ok: true });
    mocks.getDefaultLandingPath.mockReset().mockResolvedValue("/admin/dashboard");
    mocks.beginLoginAttempt.mockReset().mockResolvedValue({ kind: "allowed" });
    mocks.claimTotpCode.mockReset().mockResolvedValue({ kind: "claimed" });
    mocks.clearLoginAttempts.mockReset().mockResolvedValue(undefined);
    mocks.refundLoginAttempt.mockReset().mockResolvedValue(undefined);
    enrolledAccount(supabase);
  });

  describe("rate limit gate", () => {
    it("never reaches the password check when the attempt is refused", async () => {
      mocks.beginLoginAttempt.mockResolvedValue({
        kind: "locked",
        retryAfter: new Date(Date.now() + 10 * 60_000),
      });

      const result = await loginAction(null, form());

      expect(result.error).toMatch(/Too many sign-in attempts/);
      expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
      expect(loggedTypes()).toEqual([SYSTEM_EVENT_TYPES.LOGIN_FAILED]);
      expect(mocks.logEvent.mock.calls[0][5]).toMatchObject({ reason: "locked_out" });
    });

    it("fails closed when the limiter cannot answer", async () => {
      mocks.beginLoginAttempt.mockResolvedValue({ kind: "failed", error: new Error("rpc down") });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await loginAction(null, form());

      expect(result.error).toMatch(/temporarily unavailable/);
      expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it("checks the gate before any password work starts", async () => {
      await loginAction(null, form("123456"));

      expect(mocks.beginLoginAttempt.mock.invocationCallOrder[0]).toBeLessThan(
        supabase.auth.signInWithPassword.mock.invocationCallOrder[0]
      );
    });
  });

  describe("password step with MFA enrolled", () => {
    it("asks for the code and hands the attempt refund to after(), not the reply", async () => {
      const result = await loginAction(null, form());

      expect(result).toEqual({ status: "mfa_required" });
      expect(mocks.refundLoginAttempt).not.toHaveBeenCalled();
      expect(mocks.after).toHaveBeenCalledTimes(1);
      await runScheduled();
      expect(mocks.refundLoginAttempt).toHaveBeenCalledWith(EMAIL, IP);
    });

    it("does not read the factor list before a code is submitted", async () => {
      await loginAction(null, form());

      expect(supabase.auth.mfa.listFactors).not.toHaveBeenCalled();
      expect(supabase.auth.mfa.verify).not.toHaveBeenCalled();
    });

    it("refuses a deactivated account before it asks for a code", async () => {
      supabase.single.mockResolvedValue({
        data: { is_active: false, role: "admin", department: null, full_name: "Ada" },
        error: null,
      });

      const result = await loginAction(null, form());

      expect(result.error).toMatch(/deactivated/);
      expect(result.status).toBeUndefined();
      expect(supabase.auth.signOut).toHaveBeenCalled();
      expect(mocks.refundLoginAttempt).not.toHaveBeenCalled();
    });
  });

  describe("code step", () => {
    it("accepts a correct code and starts the replay claim only after verify", async () => {
      const result = await loginAction(null, form("123 456"));

      expect(result).toEqual({ success: true, redirectUrl: "/admin/dashboard" });
      const verifyOrder = supabase.auth.mfa.verify.mock.invocationCallOrder[0];
      expect(verifyOrder).toBeLessThan(mocks.claimTotpCode.mock.invocationCallOrder[0]);
      expect(mocks.claimTotpCode).toHaveBeenCalledWith("factor-1", "123456");
    });

    it("looks up the landing path while the replay claim is still running", async () => {
      let releaseClaim: (value: { kind: "claimed" }) => void = () => {};
      mocks.claimTotpCode.mockReturnValue(new Promise((resolve) => (releaseClaim = resolve)));

      const pending = loginAction(null, form("123456"));
      await vi.waitFor(() => expect(mocks.getDefaultLandingPath).toHaveBeenCalled());
      releaseClaim({ kind: "claimed" });

      expect(await pending).toMatchObject({ success: true });
    });

    it("writes the counter reset and the success audit row after the reply, with the same content", async () => {
      await loginAction(null, form("123456"));

      expect(mocks.after).toHaveBeenCalledTimes(2);
      expect(mocks.clearLoginAttempts).not.toHaveBeenCalled();
      expect(loggedTypes()).not.toContain(SYSTEM_EVENT_TYPES.LOGIN_SUCCESS);

      await runScheduled();

      expect(mocks.clearLoginAttempts).toHaveBeenCalledWith(EMAIL, IP);
      expect(mocks.logEvent).toHaveBeenCalledWith(
        supabase,
        "user-1",
        SYSTEM_EVENT_TYPES.LOGIN_SUCCESS,
        "User Ada (admin) successfully logged in",
        IP
      );
    });

    it("does not accept the session when verify rejects the code", async () => {
      supabase.auth.mfa.verify.mockResolvedValue({ data: null, error: { code: "invalid", message: "bad" } });

      const result = await loginAction(null, form("000000"));

      expect(result.error).toBe("Invalid verification code. Please try again.");
      expect(result.success).toBeUndefined();
      expect(mocks.claimTotpCode).not.toHaveBeenCalled();
      expect(supabase.auth.signOut).toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
      expect(loggedTypes()).toEqual([SYSTEM_EVENT_TYPES.LOGIN_FAILED]);
    });

    it("refuses a replayed code with no success audit row and no counter reset", async () => {
      mocks.claimTotpCode.mockResolvedValue({ kind: "replayed" });

      const result = await loginAction(null, form("123456"));

      expect(result.error).toMatch(/already been used/);
      expect(result.success).toBeUndefined();
      expect(supabase.auth.signOut).toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
      expect(mocks.logEvent).toHaveBeenCalledWith(
        supabase,
        "user-1",
        SYSTEM_EVENT_TYPES.LOGIN_FAILED,
        "Reused MFA code rejected for user Ada",
        IP,
        { reason: "totp_replay" }
      );
    });

    it("fails closed when the replay check cannot be made", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.claimTotpCode.mockResolvedValue({ kind: "failed", error: new Error("rpc down") });

      const result = await loginAction(null, form("123456"));

      expect(result.error).toMatch(/temporarily unavailable/);
      expect(result.success).toBeUndefined();
      expect(supabase.auth.signOut).toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
    });

    it("refuses when the factor list cannot be read, rather than treating it as empty", async () => {
      supabase.auth.mfa.listFactors.mockResolvedValue({ data: null, error: { message: "boom" } });

      const result = await loginAction(null, form("123456"));

      expect(result.error).toMatch(/Failed to retrieve MFA factors/);
      expect(supabase.auth.mfa.challenge).not.toHaveBeenCalled();
      expect(supabase.auth.mfa.verify).not.toHaveBeenCalled();
    });

    it("refuses when the account has no verified TOTP factor", async () => {
      supabase.auth.mfa.listFactors.mockResolvedValue({
        data: { all: [], totp: [], phone: [], webauthn: [] },
        error: null,
      });

      const result = await loginAction(null, form("123456"));

      expect(result.error).toBe("Verified MFA factor not found on account.");
      expect(supabase.auth.mfa.challenge).not.toHaveBeenCalled();
    });
  });

  describe("profile and assurance reads", () => {
    it("reads the profile and the factor list together, not one after the other", async () => {
      let releaseProfile: (value: unknown) => void = () => {};
      supabase.single.mockReturnValue(new Promise((resolve) => (releaseProfile = resolve)));

      const pending = loginAction(null, form("123456"));
      await vi.waitFor(() => expect(supabase.auth.mfa.listFactors).toHaveBeenCalled());
      releaseProfile({
        data: { is_active: true, role: "admin", department: null, full_name: "Ada" },
        error: null,
      });

      expect(await pending).toMatchObject({ success: true });
    });

    it("still refuses a missing profile even though the other reads succeeded", async () => {
      supabase.single.mockResolvedValue({ data: null, error: { code: "PGRST116", message: "none" } });

      const result = await loginAction(null, form("123456"));

      expect(result.error).toBe("User profile not found. Please contact your administrator.");
      expect(supabase.auth.mfa.verify).not.toHaveBeenCalled();
      expect(mocks.claimTotpCode).not.toHaveBeenCalled();
      expect(supabase.auth.signOut).toHaveBeenCalled();
    });

    it("refuses a deactivated account even though the factor list was read", async () => {
      supabase.single.mockResolvedValue({
        data: { is_active: false, role: "admin", department: null, full_name: "Ada" },
        error: null,
      });

      const result = await loginAction(null, form("123456"));

      expect(result.error).toMatch(/deactivated/);
      expect(supabase.auth.mfa.verify).not.toHaveBeenCalled();
      expect(mocks.claimTotpCode).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
    });

    it("ignores a failed factor-list read when no second factor is required", async () => {
      supabase.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
        data: { currentLevel: "aal1", nextLevel: "aal1" },
        error: null,
      });
      supabase.auth.mfa.listFactors.mockResolvedValue({ data: null, error: { message: "boom" } });

      const result = await loginAction(null, form());

      expect(result).toEqual({ success: true, redirectUrl: "/admin/dashboard" });
      expect(mocks.claimTotpCode).not.toHaveBeenCalled();
    });

    it("sends a must-change-password account to set-password, after the same checks", async () => {
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: { id: "user-1", app_metadata: { must_change_password: true } } },
        error: null,
      });
      supabase.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
        data: { currentLevel: "aal1", nextLevel: "aal1" },
        error: null,
      });

      const result = await loginAction(null, form());

      expect(result).toEqual({ success: true, redirectUrl: "/set-password" });
      expect(mocks.getDefaultLandingPath).not.toHaveBeenCalled();
    });
  });

  describe("after() failures", () => {
    it("logs a failed audit write instead of dropping it", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.logEvent.mockImplementation(async (_client, _user, type: string) => {
        if (type === SYSTEM_EVENT_TYPES.LOGIN_SUCCESS) throw new Error("audit insert failed");
        return { ok: true };
      });

      await loginAction(null, form("123456"));
      await runScheduled();

      expect(errorSpy).toHaveBeenCalledWith(
        "Login: the login audit row failed after the response:",
        expect.any(Error)
      );
    });

    it("logs a failed counter reset instead of dropping it", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.clearLoginAttempts.mockRejectedValue(new Error("rpc down"));

      await loginAction(null, form("123456"));
      await runScheduled();

      expect(errorSpy).toHaveBeenCalledWith(
        "Login: clearing login attempts failed after the response:",
        expect.any(Error)
      );
    });
  });
});
