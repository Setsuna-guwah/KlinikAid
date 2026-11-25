import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ limit: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/helpers", () => ({ requirePermission: async () => ({ id: "specialist" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const query = { select: () => query, or: () => query, gte: () => query, lte: () => query, eq: () => query, limit: mocks.limit };
    return {
      auth: { getUser: async () => ({ data: { user: { id: "specialist" } }, error: null }) },
      from: () => query,
      rpc: mocks.rpc,
    };
  },
}));

const a = "aaaaaaaa-0000-0000-0000-000000000000";
const b = "bbbbbbbb-0000-0000-0000-000000000000";
const get = (qs = "") => GET(new Request(`http://test/api/specialist/patients${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue({ data: [{ id: a, first_name: "A" }, { id: b, first_name: "B" }], error: null, count: 2 });
  mocks.rpc.mockResolvedValue({
    data: [{ specialist_patient_id: a, total_records: 3, flagged_count: 1, last_test_date: "2026-11-01T00:00:00+00:00" }],
    error: null,
  });
});

describe("GET /api/specialist/patients record stats (#263)", () => {
  it("uses the grouped stats, with zeroes for a patient without records", async () => {
    const body = await (await get()).json();
    expect(mocks.rpc).toHaveBeenCalledWith("specialist_patient_record_stats", {
      patient_ids: [a, b], p_test_type: null, p_from: null, p_to: null,
    });
    expect(body.data.patients.map((p: Record<string, unknown>) => [p.id, p.total_records, p.flagged_count, p.last_test_date])).toEqual([
      [a, 3, 1, "2026-11-01T00:00:00+00:00"],
      [b, 0, 0, null],
    ]);
  });

  it("passes record filters and drops patients with no matching record", async () => {
    const body = await (await get("?department=Hematology&startDate=2026-10-01")).json();
    expect(mocks.rpc).toHaveBeenCalledWith("specialist_patient_record_stats", {
      patient_ids: [a, b], p_test_type: "Hematology", p_from: "2026-10-01", p_to: null,
    });
    expect(body.data.patients.map((p: Record<string, unknown>) => p.id)).toEqual([a]);
  });

  it("fails rather than reporting zero records when the stats call fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "PGRST202" } });
    expect((await get()).status).toBeGreaterThanOrEqual(400);
  });
});
