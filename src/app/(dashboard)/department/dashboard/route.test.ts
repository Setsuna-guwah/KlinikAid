import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ live: true, perms: new Set<string>() }));
vi.mock("@/lib/auth/helpers", () => ({
  hasAnyPermission: async (_id: string, names: string[]) => names.some((n) => mocks.perms.has(n)),
  verifiedSessionWith: async <T,>(read: (id: string) => PromiseLike<T>) => {
    const value = await read("u-1");
    return mocks.live ? { user: { id: "u-1" }, value } : null;
  },
}));

const { GET } = await import("./route");
const location = async () => (await GET()).headers.get("Location");

beforeEach(() => {
  mocks.live = true;
  mocks.perms = new Set();
});

describe("GET /department/dashboard (#241)", () => {
  it("sends a records holder to the records page", async () => {
    mocks.perms = new Set(["records.manage.own_dept"]);
    expect(await location()).toBe("/department/records");
  });

  it("refuses a department-area user who may not record results", async () => {
    mocks.perms = new Set(["queue.manage"]);
    expect(await location()).toBe("/403");
  });

  it("sends a session the Auth server no longer recognises to login", async () => {
    mocks.live = false;
    mocks.perms = new Set(["records.manage"]);
    expect(await location()).toBe("/login");
  });
});
