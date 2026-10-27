import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { AuthError } from "@/lib/api-response";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(), roleSingle: vi.fn(), profileSingle: vi.fn(),
  profileUpdate: vi.fn(), profileUpdateSingle: vi.fn(),
  createAuthUser: vi.fn(), deleteAuthUser: vi.fn(), logEvent: vi.fn(),
  profilesOrder: vi.fn(), getUserById: vi.fn(), listUsers: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/auth/helpers", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    from: (table: string) =>
      table === "roles"
        ? { select: () => ({ eq: () => ({ single: mocks.roleSingle }) }) }
        : {
            select: () => ({
              eq: () => ({ single: mocks.profileSingle }),
              neq: () => ({ order: mocks.profilesOrder }),
            }),
            update: (values: Record<string, unknown>) => {
              mocks.profileUpdate(values);
              return { eq: () => ({ select: () => ({ single: mocks.profileUpdateSingle }) }) };
            },
          },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: {
      createUser: mocks.createAuthUser, deleteUser: mocks.deleteAuthUser,
      getUserById: mocks.getUserById, listUsers: mocks.listUsers,
    } },
  }),
}));
vi.mock("@/lib/logger", () => ({ logEvent: mocks.logEvent }));

const roleId = "00000000-0000-0000-0000-0000000000aa";
const newUserId = "00000000-0000-0000-0000-0000000000bb";
const postBody = {
  email: "throwaway.staff@example.com",
  password: "Str0ng-Throwaway!",
  fullName: "Throwaway Staff",
  roleId,
  department: null,
  employeeType: "Reception",
};
const post = () => POST(new Request("http://test/api/admin/staff", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(postBody),
}));

/** A caller that holds every permission but the named one. */
function refuse(permission: string) {
  mocks.requirePermission.mockImplementation(async (name: string) => {
    if (name === permission) throw new AuthError(403, `FORBIDDEN: Missing permission '${name}'`);
    return { id: "admin" };
  });
}
const checkedPermissions = () => mocks.requirePermission.mock.calls.map((call) => call[0]);
const noWrites = () => {
  expect(mocks.createAuthUser).not.toHaveBeenCalled();
  expect(mocks.profileUpdate).not.toHaveBeenCalled();
  expect(mocks.logEvent).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ id: "admin" });
  mocks.roleSingle.mockResolvedValue({
    data: { id: roleId, name: "receptionist", is_system: true, base_role: "receptionist" }, error: null,
  });
  mocks.profileSingle.mockResolvedValue({ data: { id: newUserId }, error: null });
  mocks.profileUpdateSingle.mockResolvedValue({ data: { id: newUserId, role_id: roleId }, error: null });
  mocks.createAuthUser.mockResolvedValue({ data: { user: { id: newUserId, email: postBody.email } }, error: null });
  mocks.deleteAuthUser.mockResolvedValue({ error: null });
  mocks.logEvent.mockResolvedValue({ ok: true });
});

describe("staff create permission preflight", () => {
  it("checks staff.manage, roles.read and profiles.manage before any Auth or profile write", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(checkedPermissions()).toEqual(["staff.manage", "roles.read", "profiles.manage"]);
    expect(mocks.createAuthUser).toHaveBeenCalledWith(expect.objectContaining({
      email: postBody.email,
      app_metadata: expect.objectContaining({ role: "receptionist" }),
    }));
    expect(mocks.profileUpdate).toHaveBeenCalledWith(expect.objectContaining({ role_id: roleId }));
    expect(mocks.logEvent).toHaveBeenCalledWith(expect.anything(), "admin", "STAFF_CREATED",
      expect.any(String), null, expect.anything());
  });

  it("refuses creation missing roles.read before reading roles or touching Auth", async () => {
    refuse("roles.read");
    const response = await post();
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Forbidden: Access denied.");
    expect(checkedPermissions()).toEqual(["staff.manage", "roles.read"]);
    expect(mocks.roleSingle).not.toHaveBeenCalled();
    noWrites();
  });

  it("refuses creation missing profiles.manage before reading roles or touching Auth", async () => {
    refuse("profiles.manage");
    const response = await post();
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Forbidden: Access denied.");
    expect(checkedPermissions()).toEqual(["staff.manage", "roles.read", "profiles.manage"]);
    expect(mocks.roleSingle).not.toHaveBeenCalled();
    noWrites();
  });

  it("answers a caller without staff.manage without checking or running anything else", async () => {
    refuse("staff.manage");
    const response = await post();
    expect(response.status).toBe(403);
    expect(checkedPermissions()).toEqual(["staff.manage"]);
    expect(mocks.roleSingle).not.toHaveBeenCalled();
    noWrites();
  });

  it("lets a caller with staff.manage, roles.read and profiles.manage create staff without roles.manage", async () => {
    // The issue's restricted custom-role caller: staff creation must not grow a
    // roles.manage requirement, and the route must never ask for one.
    refuse("roles.manage");
    const response = await post();
    expect(response.status).toBe(201);
    expect(checkedPermissions()).toEqual(["staff.manage", "roles.read", "profiles.manage"]);
    expect(mocks.createAuthUser).toHaveBeenCalled();
    expect(mocks.profileUpdate).toHaveBeenCalledWith(expect.objectContaining({ role_id: roleId }));
  });
});

describe("staff create role validation", () => {
  it("answers an unknown roleId with 400 before any Auth work for an authorized caller", async () => {
    mocks.roleSingle.mockResolvedValue({ data: null, error: { code: "PGRST116", message: "not found" } });
    const response = await post();
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Select a valid role.");
    noWrites();
  });
});

// The registry is one list_staff_registry() call made with the caller's client
// (#236). Only when that function is not installed does GET fall back to one
// Auth lookup per staff profile, the path #229 made correct for emails.
const missingFunction = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };

describe("staff registry GET: one database call", () => {
  const registryRow = (n: number, email: string | null) => ({
    id: `00000000-0000-0000-0000-0000000000${n}`,
    full_name: `Staff ${n}`,
    email,
    role: "receptionist",
    role_id: roleId,
    department: null,
    employee_type: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  });

  beforeEach(() => {
    mocks.profilesOrder.mockReset();
    mocks.getUserById.mockReset();
    mocks.listUsers.mockReset();
    mocks.rpc.mockReset();
  });

  it("returns the registry from one list_staff_registry() call, with no Auth lookups", async () => {
    mocks.rpc.mockResolvedValue({ data: [registryRow(1, "a@example.com"), registryRow(2, null)], error: null });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("list_staff_registry");
    expect(mocks.profilesOrder).not.toHaveBeenCalled();
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();

    const rows = (await response.json()).data as Record<string, unknown>[];
    expect(rows.map((row) => row.email)).toEqual(["a@example.com", ""]);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "created_at", "department", "email", "employee_type", "full_name", "id", "is_active", "role", "role_id",
    ]);
  });

  it("refuses a caller without staff.manage before the registry is read", async () => {
    refuse("staff.manage");
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 403 when the database refuses the caller, as requirePermission does", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "FORBIDDEN: Missing permission staff.manage" } });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it("fails the request, never an empty registry, when the call fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } });
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    expect(mocks.profilesOrder).not.toHaveBeenCalled();
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it("fails the request on a non-array payload instead of listing nothing", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const response = await GET();
    expect(response.status).toBe(500);
    expect((await response.json()).success).toBe(false);
  });
});

// The registry used to read ONE page of auth users (listUsers perPage: 1000)
// while the project holds ~1,460, so every staff profile past that page got an
// empty Email cell and fell out of the email search (#229). These tests cover
// the fallback that runs while migration_45 is not applied.
describe("staff registry GET: fallback while list_staff_registry is missing", () => {
  const staffProfile = (n: number) => ({
    id: `00000000-0000-0000-0000-0000000000${n}`,
    full_name: `Staff ${n}`,
    role: "receptionist",
  });

  beforeEach(() => {
    mocks.profilesOrder.mockReset();
    mocks.getUserById.mockReset();
    mocks.listUsers.mockReset();
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue(missingFunction);
  });

  it("logs the fallback and gives every staff profile its email, including ids past the first page of auth users", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const profiles = [staffProfile(1), staffProfile(2), staffProfile(3)];
    mocks.profilesOrder.mockResolvedValue({ data: profiles, error: null });
    // What the old single listUsers() call could see: only the first page.
    mocks.listUsers.mockResolvedValue({
      data: { users: [{ id: profiles[0].id, email: "first-page@example.com" }] },
      error: null,
    });
    mocks.getUserById.mockImplementation(async (id: string) => ({
      data: { user: { id, email: `mail-${id.slice(-4)}@example.com` } },
      error: null,
    }));

    const response = await GET();
    expect(response.status).toBe(200);
    const rows = (await response.json()).data as { email: string }[];
    expect(rows).toHaveLength(3);
    for (const [index, row] of rows.entries()) {
      expect(row.email).toBe(`mail-${profiles[index].id.slice(-4)}@example.com`);
    }
    expect(mocks.getUserById).toHaveBeenCalledTimes(3);
    expect(mocks.listUsers).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("migration_45"));
  });

  it("still lists a profile whose Auth user is gone, leaving only that row's email empty", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const profiles = [staffProfile(4), staffProfile(5)];
    mocks.profilesOrder.mockResolvedValue({ data: profiles, error: null });
    mocks.getUserById.mockImplementation(async (id: string) =>
      id === profiles[0].id
        ? { data: null, error: { message: "User not found" } }
        : { data: { user: { id, email: "still-here@example.com" } }, error: null }
    );

    const response = await GET();
    expect(response.status).toBe(200);
    const rows = (await response.json()).data as { email: string }[];
    expect(rows.map((row) => row.email)).toEqual(["", "still-here@example.com"]);
  });

  it("keeps the other rows when one Auth lookup throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const profiles = [staffProfile(6), staffProfile(7)];
    mocks.profilesOrder.mockResolvedValue({ data: profiles, error: null });
    mocks.getUserById.mockImplementation(async (id: string) => {
      if (id === profiles[0].id) throw new Error("network down");
      return { data: { user: { id, email: "survivor@example.com" } }, error: null };
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const rows = (await response.json()).data as { email: string }[];
    expect(rows.map((row) => row.email)).toEqual(["", "survivor@example.com"]);
  });

  it("bounds the Auth lookup concurrency", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const profiles = Array.from({ length: 25 }, (_, index) => staffProfile(10 + index));
    mocks.profilesOrder.mockResolvedValue({ data: profiles, error: null });
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.getUserById.mockImplementation(async (id: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { data: { user: { id, email: `${id}@example.com` } }, error: null };
    });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.getUserById).toHaveBeenCalledTimes(25);
    expect(maxInFlight).toBeLessThanOrEqual(10);
  });

  it("fails the request when the fallback profile read fails", async () => {
    mocks.profilesOrder.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } });
    const response = await GET();
    expect(response.status).toBe(500);
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });
});
