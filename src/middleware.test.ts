import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The middleware's session decision, with the Auth server's answer faked.
 *
 * The middleware asks the Auth server whether the session still exists
 * (`getUser`). That call is what refuses a signed-out or revoked session, so
 * these tests fake only that answer and run the real middleware and session
 * refresh around it.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
    }),
  }),
}));

const { middleware } = await import("./middleware");

const USER_ID = "3f2c1d7e-0000-4000-8000-000000000001";

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://klinikaid.test${path}`, { headers });
}

function confirmed(user: { id: string; app_metadata?: Record<string, unknown> } | null) {
  mocks.getUser.mockResolvedValue(
    user
      ? { data: { user: { app_metadata: {}, user_metadata: {}, ...user } }, error: null }
      : { data: { user: null }, error: { message: "Auth session missing!", status: 403 } }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

describe("middleware session decision", () => {
  it("sends a request with no session to sign-in from a protected route", async () => {
    confirmed(null);

    const response = await middleware(request("/admin/dashboard"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "", "https://klinikaid.test").pathname).toBe("/login");
  });

  it("refuses a signed-out or revoked session, however it is presented", async () => {
    // The Auth server no longer knows the session (it was signed out or revoked),
    // so getUser reports it missing. The cookies may still be replayed.
    confirmed(null);

    const response = await middleware(
      request("/patient/dashboard", { cookie: "sb-project-auth-token=replayed" })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("does not let an identity header from the client stand in for a session", async () => {
    confirmed(null);

    const response = await middleware(
      request("/admin/dashboard", { "x-klinikaid-auth-user": USER_ID })
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "", "https://klinikaid.test").pathname).toBe("/login");
  });

  it("writes the confirmed identity over any identity the client sent", async () => {
    confirmed({ id: USER_ID });

    const response = await middleware(
      request("/patient/dashboard", { "x-klinikaid-auth-user": "someone-else" })
    );

    // Next forwards request headers changed by the middleware under this name.
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-klinikaid-auth-user")).toBe(USER_ID);
  });
});
