import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

/**
 * A route that guards itself with `requirePermission` (no getUser of its own)
 * is refused for a signed-out session (issue #238): the token still verifies
 * locally, but the Auth server's live check fails, and that check gates the
 * session before anything read on its behalf is used. The guard's own profile
 * and permission reads start beside that check (as the dashboard layout's do)
 * and are discarded; the route's data is never read.
 */

const mocks = vi.hoisted(() => ({
  liveAnswer: { data: { user: null as null | { id: string } }, error: null as null | { message: string } },
  claims: { sub: "admin-1", aal: "aal2", email: "admin@example.com" },
  routeReads: [] as string[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-klinikaid-auth-user": "admin-1" }),
}));

vi.mock("@/lib/supabase/signing-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/signing-keys")>()),
  getSigningKeys: async () => [],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token" } }, error: null }),
      // The token verifies locally ...
      getClaims: async () => ({ data: { claims: mocks.claims }, error: null }),
      // ... but the Auth server says the session is gone.
      getUser: async () => mocks.liveAnswer,
    },
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => {
      if (table !== "profiles") mocks.routeReads.push(table);
      throw new Error("the route must not read data for a signed-out session");
    },
  }),
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  mocks.liveAnswer = { data: { user: null }, error: { message: "session_not_found" } };
  mocks.routeReads = [];
});

describe("GET /api/admin/dashboard-stats with a signed-out session", () => {
  it("answers 401 and reads none of the route's data", async () => {
    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.routeReads).toEqual([]);
  });
});
