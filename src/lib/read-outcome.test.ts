import { describe, expect, it } from "vitest";
import { classifyRead, isZeroRowsError, readErrors } from "./read-outcome";

/**
 * The error bodies below are the literal shapes returned by the live Supabase
 * project, captured via PostgREST. The 0-rows and 2-rows cases were both
 * observed to carry the same `PGRST116` code -- that collision is the reason
 * `isZeroRowsError` inspects `details` rather than the code alone.
 */
const ZERO_ROWS = {
  code: "PGRST116",
  details: "The result contains 0 rows",
  hint: null,
  message: "Cannot coerce the result to a single JSON object",
};

const TWO_ROWS = {
  code: "PGRST116",
  details: "The result contains 2 rows",
  hint: null,
  message: "Cannot coerce the result to a single JSON object",
};

// Older PostgREST wording; both variants must still read as absence.
const ZERO_ROWS_LEGACY = {
  code: "PGRST116",
  details: "Results contain 0 rows",
  hint: null,
  message: "Cannot coerce the result to a single JSON object",
};

const UNKNOWN_COLUMN = {
  code: "42703",
  details: null,
  hint: null,
  message: "column patients.no_such_column does not exist",
};

const MISSING_TABLE = {
  code: "PGRST205",
  details: null,
  hint: null,
  message: "Could not find the table 'public.no_such_table' in the schema cache",
};

const RLS_DENIED = {
  code: "42501",
  details: null,
  hint: null,
  message: "new row violates row-level security policy",
};

describe("isZeroRowsError", () => {
  it("accepts the 0-rows single-object coercion failure", () => {
    expect(isZeroRowsError(ZERO_ROWS)).toBe(true);
    expect(isZeroRowsError(ZERO_ROWS_LEGACY)).toBe(true);
  });

  it("rejects the same code when rows were actually returned", () => {
    // A duplicate-row fault reported as "this record does not exist" would be a
    // second confident wrong answer, in place of the first.
    expect(isZeroRowsError(TWO_ROWS)).toBe(false);
  });

  it("rejects genuine database failures", () => {
    expect(isZeroRowsError(UNKNOWN_COLUMN)).toBe(false);
    expect(isZeroRowsError(MISSING_TABLE)).toBe(false);
    expect(isZeroRowsError(RLS_DENIED)).toBe(false);
  });

  it("rejects non-objects and nullish input rather than throwing", () => {
    expect(isZeroRowsError(null)).toBe(false);
    expect(isZeroRowsError(undefined)).toBe(false);
    expect(isZeroRowsError("PGRST116")).toBe(false);
    expect(isZeroRowsError(new Error("boom"))).toBe(false);
  });

  it("degrades to 'failure' when PGRST116 arrives without a details field", () => {
    // Safer direction: an unreadable shape must show an error, never claim the
    // record is missing.
    expect(isZeroRowsError({ code: "PGRST116", details: null })).toBe(false);
  });
});

describe("classifyRead", () => {
  it("reports a returned row as ok", () => {
    const row = { id: "p1", first_name: "Ada" };
    expect(classifyRead({ data: row, error: null })).toEqual({ kind: "ok", data: row });
  });

  it("reports zero rows as absent, not as a failure", () => {
    expect(classifyRead({ data: null, error: ZERO_ROWS })).toEqual({ kind: "absent" });
  });

  it("reports a query failure as failed, with the error preserved", () => {
    const outcome = classifyRead({ data: null, error: UNKNOWN_COLUMN });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.error).toBe(UNKNOWN_COLUMN);
    }
  });

  it("never puts a data member on the failed branch", () => {
    // The property that makes the failure branch impossible to read past.
    expect("data" in classifyRead({ data: null, error: RLS_DENIED })).toBe(false);
    expect("data" in classifyRead({ data: null, error: ZERO_ROWS })).toBe(false);
  });

  it("treats a head-count result as ok even though data is null", () => {
    // `select("id", { count: "exact", head: true })` yields { data: null, error: null }.
    // Calling that "absent" would make every count query look like a missing row.
    expect(classifyRead({ data: null, error: null })).toEqual({ kind: "ok", data: null });
  });

  it("prefers the error over a data value the client claims alongside it", () => {
    // A result object carrying both must not be treated as ok.
    expect(classifyRead({ data: { id: "p1" }, error: UNKNOWN_COLUMN }).kind).toBe("failed");
  });
});

describe("readErrors", () => {
  it("returns null-free empty list when everything succeeded", () => {
    expect(
      readErrors([
        { kind: "ok", data: 1 },
        { kind: "absent" },
      ])
    ).toEqual([]);
  });

  it("collects every failure so a partial batch cannot read as healthy", () => {
    const errors = readErrors([
      { kind: "ok", data: 0 },
      { kind: "failed", error: UNKNOWN_COLUMN },
      { kind: "ok", data: 0 },
      { kind: "failed", error: RLS_DENIED },
    ]);
    expect(errors).toEqual([UNKNOWN_COLUMN, RLS_DENIED]);
  });

  it("does not treat absence as a failure", () => {
    // Absence is a legitimate answer; it must not raise an error banner.
    expect(readErrors([{ kind: "absent" }])).toEqual([]);
  });
});