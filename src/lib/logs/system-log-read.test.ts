import { describe, expect, it } from "vitest";
import type { SystemLogQuery } from "./system-log-query";
import { containsPattern, rpcContainsPattern } from "./system-log-query";
import { readSystemLogPage, type SupabaseServerClient } from "./system-log-read";

const BASE: SystemLogQuery = {
  page: 2,
  limit: 15,
  eventType: null,
  userId: null,
  startDate: null,
  endDate: null,
  search: null,
  download: false,
  knownTotal: null,
};

interface Call {
  columns: string;
  options: { count?: string; head?: boolean };
  range: [number, number];
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface RpcResult {
  data?: unknown;
  error?: { code: string; message?: string } | null;
}

/** A stand-in for the query builder: records the select options and answers `range`. */
function fakeClient(
  answer: { data?: unknown; count?: number | null; error?: unknown },
  rpcAnswers: RpcResult[] = [{ data: null, error: null }]
) {
  const calls: Call[] = [];
  const rpcCalls: RpcCall[] = [];
  const builder = (call: Call) => {
    const chain = {
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      ilike: () => chain,
      order: () => chain,
      range: (from: number, to: number) => {
        call.range = [from, to];
        calls.push(call);
        return Promise.resolve({ data: answer.data ?? [], count: answer.count ?? null, error: answer.error ?? null });
      },
    };
    return chain;
  };
  const client = {
    from: () => ({
      select: (columns: string, options: Call["options"] = {}) => builder({ columns, options, range: [0, 0] }),
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const r = rpcAnswers[Math.min(rpcCalls.length - 1, rpcAnswers.length - 1)];
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  } as unknown as SupabaseServerClient;
  return { client, calls, rpcCalls };
}

const PAYLOAD = {
  total: 81,
  logs: [
    {
      id: 41,
      user_id: null,
      event_type: "LOGIN_SUCCESS",
      description: "User Maria Clara Santos (receptionist) successfully logged in",
      ip_address: null,
      metadata: null,
      created_at: "2026-10-27T06:00:00+00:00",
      profile_full_name: "Maria Clara Santos",
      profile_role: "receptionist",
    },
    {
      id: 40,
      user_id: null,
      event_type: "LOGOUT",
      description: "User logged out successfully",
      ip_address: null,
      metadata: null,
      created_at: "2026-10-27T05:00:00+00:00",
      profile_full_name: null,
      profile_role: null,
    },
  ],
};

describe("readSystemLogPage", () => {
  it("counts the total exactly when no total is known", async () => {
    const { client, calls } = fakeClient({ data: [], count: 42 });
    const page = await readSystemLogPage(client, BASE);

    expect(page.total).toBe(42);
    expect(calls[0].options.count).toBe("exact");
  });

  it("reports the known total and skips the count scan when paging", async () => {
    const { client, calls } = fakeClient({ data: [], count: null });
    const page = await readSystemLogPage(client, { ...BASE, knownTotal: 42 });

    expect(page.total).toBe(42);
    expect(calls[0].options.count).toBeUndefined();
    expect(calls[0].range).toEqual([15, 29]);
  });

  it("keeps the known total on a past-the-end page without counting again", async () => {
    const { client, calls } = fakeClient({ error: { code: "PGRST103" } });
    const page = await readSystemLogPage(client, { ...BASE, knownTotal: 7 });

    expect(page).toEqual({ logs: [], total: 7 });
    expect(calls).toHaveLength(1);
  });

  it("throws on a failed read rather than reporting an empty page", async () => {
    const { client } = fakeClient({ error: { code: "XX000", message: "boom" } });

    await expect(readSystemLogPage(client, BASE)).rejects.toMatchObject({ code: "XX000" });
  });

  it("does not call the search function when the page is not searched", async () => {
    const { client, rpcCalls } = fakeClient({ data: [], count: 3 });

    await readSystemLogPage(client, BASE);

    expect(rpcCalls).toHaveLength(0);
  });
});

describe("readSystemLogPage: searched pages", () => {
  it("reads a searched page through search_system_logs and maps the payload", async () => {
    const { client, rpcCalls, calls } = fakeClient(
      { data: [], count: 0 },
      [{ data: PAYLOAD, error: null }]
    );
    const page = await readSystemLogPage(client, {
      ...BASE,
      page: 3,
      search: "Maria Clara Santos",
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("search_system_logs");
    expect(calls).toHaveLength(0); // no PostgREST table query at all
    expect(page.total).toBe(81);
    expect(page.logs).toHaveLength(2);
    expect(page.logs[0]).toMatchObject({
      id: "41",
      event_type: "LOGIN_SUCCESS",
      profiles: { full_name: "Maria Clara Santos", role: "receptionist" },
    });
    expect(page.logs[1].profiles).toBeNull();
  });

  it("sends the effective pattern the table path would evaluate, `*` included", async () => {
    const { client, rpcCalls } = fakeClient({ data: [], count: 0 }, [{ data: PAYLOAD, error: null }]);
    const term = "Maria 100% of_us \\ *4* cut";

    await readSystemLogPage(client, { ...BASE, search: term });

    // PostgREST would turn each `*` into `%` on the table path; the RPC
    // pattern must evaluate to the same ILIKE, so it applies the same
    // translation before sending. rpcContainsPattern's own tests compare
    // the two paths' patterns for each special character.
    expect(rpcCalls[0].args.p_search).toBe(rpcContainsPattern(term));
    expect(rpcCalls[0].args.p_search).toBe(containsPattern(term).replace(/\*/g, "%"));
    expect(rpcCalls[0].args.p_from).toBe(15); // page 2 * limit 15
    expect(rpcCalls[0].args.p_limit).toBe(15);
    expect(rpcCalls[0].args.p_event_type).toBeNull();
    expect(rpcCalls[0].args.p_start_date).toBeNull();
    expect(rpcCalls[0].args).not.toHaveProperty("p_known_total");
  });

  it("forwards the filters with the search", async () => {
    const { client, rpcCalls } = fakeClient({ data: [], count: 0 }, [{ data: PAYLOAD, error: null }]);
    const q = {
      ...BASE,
      eventType: "LOGIN_SUCCESS",
      userId: "22222222-2222-4222-8222-222222222222",
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-27T00:00:00.000Z",
      search: "Maria",
    };

    await readSystemLogPage(client, q);

    expect(rpcCalls[0].args).toMatchObject({
      p_event_type: "LOGIN_SUCCESS",
      p_user_id: "22222222-2222-4222-8222-222222222222",
      p_start_date: "2026-10-01T00:00:00.000Z",
      p_end_date: "2026-10-27T00:00:00.000Z",
      p_search: "%Maria%",
    });
  });

  it("reports the searched total for a past-the-end page", async () => {
    const { client } = fakeClient(
      { data: [], count: 0 },
      [{ data: { total: 81, logs: [] }, error: null }]
    );
    const page = await readSystemLogPage(client, { ...BASE, search: "Maria", page: 99 });

    expect(page).toEqual({ logs: [], total: 81 });
  });

  it("falls back to the table query while migration 46 is not applied (PGRST202)", async () => {
    const { client, rpcCalls, calls } = fakeClient(
      { data: [], count: 12 },
      [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }]
    );
    const page = await readSystemLogPage(client, { ...BASE, search: "Maria" });

    expect(rpcCalls).toHaveLength(1);
    expect(calls).toHaveLength(1); // the fallback read
    expect(calls[0].options.count).toBe("exact"); // a new search always counts
    expect(page.total).toBe(12);
  });

  it("throws on a failed search rather than reporting an empty page", async () => {
    const { client } = fakeClient(
      { data: [], count: 0 },
      [{ data: null, error: { code: "42501", message: "FORBIDDEN" } }]
    );

    await expect(readSystemLogPage(client, { ...BASE, search: "Maria" })).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("throws when the search function answers an unexpected shape", async () => {
    const { client } = fakeClient(
      { data: [], count: 0 },
      [{ data: { logs: [{ id: 1 }] }, error: null }] // missing total
    );

    await expect(readSystemLogPage(client, { ...BASE, search: "Maria" })).rejects.toThrow(
      "unexpected payload shape"
    );
  });

  it("forwards a known total so a later page of the same search skips the count", async () => {
    const { client, rpcCalls } = fakeClient({ data: [], count: 0 }, [{ data: PAYLOAD, error: null }]);

    await readSystemLogPage(client, { ...BASE, search: "Maria", knownTotal: 81 });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args.p_known_total).toBe(81);
  });

  it("retries once without the known total while migration 48 is not applied", async () => {
    const { client, rpcCalls, calls } = fakeClient({ data: [], count: 0 }, [
      { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
      { data: PAYLOAD, error: null },
    ]);

    const page = await readSystemLogPage(client, { ...BASE, search: "Maria", knownTotal: 81 });

    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0].args.p_known_total).toBe(81);
    expect(rpcCalls[1].args).not.toHaveProperty("p_known_total");
    expect(calls).toHaveLength(0); // no table fallback: migration 46's function answered
    expect(page.total).toBe(81);
  });
});
