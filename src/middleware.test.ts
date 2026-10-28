import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

/**
 * The edge middleware's session handling (issue #238): the identity comes from
 * the locally verified token, the identity header cannot be forged, and an
 * expired access token is refreshed through the cookies.
 */

const AUTH_USER_HEADER = "x-klinikaid-auth-user";

const mocks = vi.hoisted(() => ({
  /** The claims `getClaims()` answers with, or null for no session. */
  claims: null as { sub: string; app_metadata?: Record<string, unknown> } | null,
  /** Cookies the client writes during `getClaims()`, as a token refresh does. */
  refreshedCookies: [] as { name: string; value: string; options?: Record<string, unknown> }[],
  /** Arguments `getClaims()` was called with. */
  getClaimsArgs: [] as unknown[][],
  cookieOptions: null as CookieOptions | null,
}));

type CookieOptions = { cookies: { setAll: (cookies: unknown[]) => void } };

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: CookieOptions) => {
    mocks.cookieOptions = options;
    return {
      auth: {
        getClaims: async (...args: unknown[]) => {
          mocks.getClaimsArgs.push(args);
          if (mocks.refreshedCookies.length > 0) {
            // What `getClaims()` does with no token: read the session, refresh
            // it if the access token expired, and hand the cookies to setAll.
            options.cookies.setAll(mocks.refreshedCookies);
          }
          return mocks.claims
            ? { data: { claims: { ...mocks.claims } }, error: null }
            : { data: null, error: null };
        },
      },
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { role: "patient" }, error: null }) }) }),
      }),
    };
  },
}));

vi.mock("@/lib/supabase/signing-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/signing-keys")>()),
  getSigningKeys: async () => [],
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  mocks.claims = null;
  mocks.refreshedCookies = [];
  mocks.getClaimsArgs = [];
});

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://klinikaid.test${path}`, { headers });
}

describe("middleware identity header", () => {
  it("replaces a forged identity header with the verified user's id", async () => {
    mocks.claims = { sub: "real-user", app_metadata: {} };

    const response = await middleware(
      request("/patient/dashboard", { [AUTH_USER_HEADER]: "attacker-chosen-id" })
    );

    // The middleware forwards the header it wrote, and only that one.
    expect(response.headers.get(`x-middleware-request-${AUTH_USER_HEADER}`)).toBe("real-user");
  });

  it("strips a forged identity header when there is no verified session", async () => {
    mocks.claims = null;

    const response = await middleware(
      request("/api/department/records", { [AUTH_USER_HEADER]: "attacker-chosen-id" })
    );

    // Not redirected (the route answers itself), and no identity is forwarded:
    // the forged value is gone, not passed on.
    expect(response.headers.get(`x-middleware-request-${AUTH_USER_HEADER}`)).toBeNull();
    expect(response.headers.get(`x-middleware-override-headers`) ?? "").not.toContain(AUTH_USER_HEADER);
  });

  it("sends an anonymous visitor to login whatever identity header they send", async () => {
    mocks.claims = null;

    const response = await middleware(
      request("/patient/dashboard", { [AUTH_USER_HEADER]: "attacker-chosen-id" })
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });
});

describe("middleware session refresh", () => {
  it("verifies the token without a token argument, so an expired access token is refreshed", async () => {
    mocks.claims = { sub: "real-user", app_metadata: {} };

    await middleware(request("/patient/dashboard"));

    // No token argument: the client reads the session from the cookies and
    // refreshes it first, the same as the getUser() call it replaces.
    expect(mocks.getClaimsArgs[0]?.[0]).toBeUndefined();
  });

  it("writes the refreshed session cookies on the response", async () => {
    mocks.claims = { sub: "real-user", app_metadata: {} };
    mocks.refreshedCookies = [
      { name: "sb-project-auth-token", value: "refreshed-session", options: { path: "/" } },
    ];

    const response = await middleware(request("/patient/dashboard"));

    expect(response.headers.get("set-cookie")).toContain("sb-project-auth-token=refreshed-session");
  });
});
