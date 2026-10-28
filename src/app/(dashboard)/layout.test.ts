import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardLayout from "./layout";

/**
 * The dashboard layout's session gate (issue #238). Its reads start before the
 * Auth server has confirmed the session, but nothing they return is used for a
 * session the Auth server no longer recognises, and staff still pass the MFA
 * gate on their verified assurance level.
 */

const mocks = vi.hoisted(() => ({
  pending: null as null | { session: { user: { id: string; email: string }; aal: string | null }; live: Promise<boolean> },
  profile: null as null | Record<string, unknown>,
  profileReads: 0,
  listFactors: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-pathname": "/admin/dashboard" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut: mocks.signOut, mfa: { listFactors: mocks.listFactors } } }),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

vi.mock("@/lib/logger", () => ({ logEvent: vi.fn(async () => undefined) }));

vi.mock("@/components/DashboardLayoutClient", () => ({ default: () => null }));

vi.mock("@/components/sidebar", () => ({}));

vi.mock("@/lib/perf/timing", () => ({
  timed: async <T,>(_name: string, fn: () => PromiseLike<T> | T) => fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  startRequestSession: async () => mocks.pending,
}));

vi.mock("@/lib/auth/helpers", () => ({
  getDashboardAccess: async () => ({
    roleName: "Administrator",
    permissions: new Set(["profiles.manage", "system_logs.read"]),
  }),
  permissionHolder: (_userId: string, access: { permissions: Set<string> } | null) => async (name: string) =>
    access ? access.permissions.has(name) : false,
  getProfile: async () => {
    mocks.profileReads += 1;
    return mocks.profile;
  },
}));

const adminProfile = {
  id: "user-123",
  role: "admin",
  role_id: "role-1",
  department: null,
  full_name: "Test Admin",
  is_active: true,
  accepted_privacy_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  mocks.profile = { ...adminProfile };
  mocks.profileReads = 0;
  mocks.listFactors.mockReset();
  mocks.signOut.mockClear();
});

function pendingSession(aal: string | null, live: boolean) {
  return {
    session: { user: { id: "user-123", email: "admin@example.com" }, aal },
    live: Promise.resolve(live),
  };
}

describe("dashboard layout session gate", () => {
  it("refuses a signed-out session even though its token verifies locally", async () => {
    mocks.pending = pendingSession("aal2", false);

    await expect(DashboardLayout({ children: null })).rejects.toThrow("REDIRECT:/login");
    // The profile was read in parallel with the revocation check ...
    expect(mocks.profileReads).toBe(1);
    // ... but its answer was not used: no sign-out or render path ran for it.
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("refuses when there is no verified session at all", async () => {
    mocks.pending = null;

    await expect(DashboardLayout({ children: null })).rejects.toThrow("REDIRECT:/login");
    expect(mocks.profileReads).toBe(0);
  });

  it("sends an aal1 staff session without a verified factor to MFA enrolment", async () => {
    mocks.pending = pendingSession("aal1", true);
    mocks.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });

    await expect(DashboardLayout({ children: null })).rejects.toThrow("REDIRECT:/mfa-enroll");
  });

  it("signs out an aal1 staff session whose account has a verified factor", async () => {
    mocks.pending = pendingSession("aal1", true);
    mocks.listFactors.mockResolvedValue({
      data: { totp: [{ id: "f1", status: "verified", factor_type: "totp" }] },
      error: null,
    });

    await expect(DashboardLayout({ children: null })).rejects.toThrow("REDIRECT:/login?error=mfa_required");
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it("lets an aal2 staff session with a live check through", async () => {
    mocks.pending = pendingSession("aal2", true);

    await expect(DashboardLayout({ children: null })).resolves.toBeDefined();
    // The MFA claim was enough: the factor list was not read.
    expect(mocks.listFactors).not.toHaveBeenCalled();
  });
});
