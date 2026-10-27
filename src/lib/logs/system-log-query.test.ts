import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  containsPattern,
  isInvertedRange,
  parseSystemLogQuery,
  phtDayEnd,
  phtDayStart,
} from "./system-log-query";

const parse = (qs: string) => parseSystemLogQuery(new URLSearchParams(qs));

function errorOf(qs: string): string {
  const r = parse(qs);
  if (r.ok) throw new Error(`expected ${qs} to be rejected`);
  return r.error;
}

describe("parseSystemLogQuery", () => {
  it("defaults page and limit", () => {
    const r = parse("");
    expect(r.ok && r.query.page).toBe(1);
    expect(r.ok && r.query.limit).toBe(DEFAULT_PAGE_SIZE);
  });

  // Each row of the #65 table that previously produced a 500 or a silent empty page.
  it.each(["page=-5", "page=0", "page=abc", "page=1.5", "page="])("rejects %s naming page", (qs) => {
    expect(errorOf(qs)).toMatch(/^page/);
  });

  it.each(["limit=-1", "limit=0", "limit=abc"])("rejects %s naming limit", (qs) => {
    expect(errorOf(qs)).toMatch(/^limit/);
  });

  it("clamps an oversized limit instead of serving it", () => {
    const r = parse("limit=100000");
    expect(r.ok && r.query.limit).toBe(MAX_PAGE_SIZE);
  });

  it("accepts a page far past the end (the route answers it with an empty page)", () => {
    const r = parse("page=99999");
    expect(r.ok && r.query.page).toBe(99999);
  });

  it("rejects a page whose offset is not a safe integer", () => {
    expect(errorOf("page=99999999999999999999")).toMatch(/^page/);
  });

  it.each([
    ["startDate=garbage", /^startDate/],
    ["startDate=1", /^startDate/], // Date.parse reads this as the year 2001
    ["endDate=2026-13-45", /^endDate/],
  ])("rejects %s", (qs, msg) => {
    expect(errorOf(qs)).toMatch(msg);
  });

  // Date.parse rolls these over instead of rejecting them: 2026-02-30 becomes
  // 2 March and T24:00 becomes the next midnight, so the filter would silently
  // cover a different day than the one asked for.
  it.each([
    "startDate=2026-02-30",
    "startDate=2026-02-31T10:00:00Z",
    "startDate=2025-02-29",
    "startDate=2026-04-31",
    "startDate=2026-02-28T24:00:00Z",
  ])("rejects the impossible date %s rather than rolling it over", (qs) => {
    expect(errorOf(qs)).toMatch(/^startDate/);
  });

  it("rejects an impossible endDate", () => {
    expect(errorOf("endDate=2026-06-31")).toMatch(/^endDate/);
  });

  it("accepts real edge-of-calendar dates", () => {
    const r = parse("startDate=2024-02-29&endDate=2026-12-31T23:59:59.999Z");
    expect(r.ok && r.query.startDate).toBe("2024-02-29T00:00:00.000Z");
    expect(r.ok && r.query.endDate).toBe("2026-12-31T23:59:59.999Z");
  });

  it("normalises valid dates to ISO", () => {
    const r = parse("startDate=2026-10-01&endDate=2026-10-05T15:59:59.999Z");
    expect(r.ok && r.query.startDate).toBe("2026-10-01T00:00:00.000Z");
    expect(r.ok && r.query.endDate).toBe("2026-10-05T15:59:59.999Z");
  });

  it("rejects an inverted date range", () => {
    expect(errorOf("startDate=2026-10-05&endDate=2026-10-01")).toBe("startDate is after endDate.");
  });

  it("rejects a non-UUID userId rather than letting Postgres fail the cast", () => {
    expect(errorOf("userId=not-a-uuid")).toMatch(/^userId/);
  });

  it("keeps search separate from eventType", () => {
    const r = parse("search=%20logged%20in%20&eventType=LOGIN_SUCCESS");
    expect(r.ok && r.query.search).toBe("logged in");
    expect(r.ok && r.query.eventType).toBe("LOGIN_SUCCESS");
  });

  it("treats a blank search as no search", () => {
    const r = parse("search=%20%20");
    expect(r.ok && r.query.search).toBeNull();
  });

  it("rejects an overlong search", () => {
    expect(errorOf(`search=${"a".repeat(201)}`)).toMatch(/^search/);
  });
});

describe("parseSystemLogQuery knownTotal", () => {
  it("defaults to counting the total", () => {
    const result = parse("page=2");
    expect(result.ok && result.query.knownTotal).toBeNull();
  });

  it("accepts a known total of zero or more for paging", () => {
    const result = parse("page=2&knownTotal=0");
    expect(result.ok && result.query.knownTotal).toBe(0);
    const big = parse("page=2&knownTotal=42");
    expect(big.ok && big.query.knownTotal).toBe(42);
  });

  it.each(["-1", "1.5", "abc", "", "01", "9007199254740993"])("rejects %s as a total", (raw) => {
    const result = parse(`knownTotal=${raw}`);
    expect(result.ok).toBe(false);
  });
});

describe("containsPattern", () => {
  it("wraps the term for a substring match", () => {
    expect(containsPattern("logged in")).toBe("%logged in%");
  });

  it("escapes LIKE wildcards so they match literally", () => {
    expect(containsPattern("100%")).toBe("%100\\%%");
    expect(containsPattern("LOGIN_")).toBe("%LOGIN\\_%");
    expect(containsPattern("a\\b")).toBe("%a\\\\b%");
  });
});

describe("phtDayStart / phtDayEnd", () => {
  // `new Date("2026-10-14")` is UTC midnight, i.e. 08:00 in Manila, so picking
  // Oct 14 used to drop that day's first eight hours from the filter.
  it("covers the whole Manila calendar day", () => {
    expect(phtDayStart("2026-10-14")).toBe("2026-10-13T16:00:00.000Z");
    expect(phtDayEnd("2026-10-14")).toBe("2026-10-14T15:59:59.999Z");
  });

  it("does not depend on the browser's timezone", () => {
    const tz = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      expect(phtDayStart("2026-10-14")).toBe("2026-10-13T16:00:00.000Z");
      expect(phtDayEnd("2026-10-14")).toBe("2026-10-14T15:59:59.999Z");
    } finally {
      process.env.TZ = tz;
    }
  });

  it("yields bounds the API accepts", () => {
    const r = parse(`startDate=${phtDayStart("2026-10-14")}&endDate=${phtDayEnd("2026-10-14")}`);
    expect(r.ok).toBe(true);
  });
});

describe("isInvertedRange", () => {
  it("is false when either bound is missing or the range is ordered", () => {
    expect(isInvertedRange(null, "2026-10-01T00:00:00Z")).toBe(false);
    expect(isInvertedRange("2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z")).toBe(false);
  });

  it("is true when the start falls after the end", () => {
    expect(isInvertedRange("2026-10-02T00:00:00Z", "2026-10-01T23:59:59Z")).toBe(true);
  });
});
