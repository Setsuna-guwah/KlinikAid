import { describe, expect, it } from "vitest";
import type { SystemLogQuery } from "./system-log-query";
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

/** A stand-in for the query builder: records the select options and answers `range`. */
function fakeClient(answer: { data?: unknown; count?: number | null; error?: unknown }) {
  const calls: Call[] = [];
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
  } as unknown as SupabaseServerClient;
  return { client, calls };
}

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
});
