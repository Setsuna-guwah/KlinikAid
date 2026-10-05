import { describe, expect, it } from "vitest";
import { getAge } from "./utils";

/**
 * Every reference time here is built with `Date.UTC` rather than `new Date(y, m, d)`
 * so the expectations do not depend on the machine's timezone. `getAge` reads UTC
 * calendar fields, so a local-time construction would make these tests pass or fail
 * depending on where they run.
 */
const at = (
  year: number,
  month: number,
  day: number,
  hours = 12
) => Date.UTC(year, month - 1, day, hours, 0, 0);

describe("getAge", () => {
  it("counts whole years, not millisecond years", () => {
    // 30 years and 1 day. Under the old millisecond-duration implementation this
    // was 30 as well, by luck of the leap-day count; the point of the case is that
    // the calendar answer is 30 and does not depend on luck.
    expect(getAge("1995-06-15", at(2025, 6, 16))).toBe(30);
  });

  it("is one short on the day before the birthday", () => {
    // The 82nd birthday is tomorrow, so today the patient is 81. The old
    // implementation reported 82 here.
    expect(getAge("1943-04-09", at(2025, 4, 8))).toBe(81);
  });

  it("counts the birthday from midnight local-to-UTC onwards, not at some hour later", () => {
    expect(getAge("1995-06-15", at(2025, 6, 15, 0))).toBe(30);
    expect(getAge("1995-06-15", at(2025, 6, 15, 23))).toBe(30);
  });

  it("keeps the age across the whole month the birthday falls in", () => {
    expect(getAge("1995-06-15", at(2025, 6, 15))).toBe(30);
    expect(getAge("1995-06-15", at(2025, 7, 14))).toBe(30);
    expect(getAge("1995-06-15", at(2025, 7, 15))).toBe(30);
  });

  it("handles a birthday on the first of the month", () => {
    expect(getAge("1995-01-01", at(2024, 12, 31))).toBe(29);
    expect(getAge("1995-01-01", at(2025, 1, 1))).toBe(30);
  });

  it("handles a birthday on the last day of the month", () => {
    expect(getAge("1995-12-31", at(2025, 12, 30))).toBe(29);
    expect(getAge("1995-12-31", at(2025, 12, 31))).toBe(30);
  });

  it("treats a leap-day birthday as falling on March 1 in a non-leap year", () => {
    // There is no 29 February to compare against in 2025, so the field comparison
    // lands on 1 March. That is the conventional reading of a 29 Feb birthday off
    // a leap year, and it is one day earlier than the old implementation's answer.
    expect(getAge("2004-02-29", at(2025, 2, 28))).toBe(20);
    expect(getAge("2004-02-29", at(2025, 3, 1))).toBe(21);
    // In a leap reference year the comparison is exact.
    expect(getAge("2004-02-29", at(2024, 2, 28))).toBe(19);
    expect(getAge("2004-02-29", at(2024, 2, 29))).toBe(20);
  });

  it("reports 0 for a newborn rather than rounding down to nothing", () => {
    expect(getAge("2026-10-05", at(2026, 10, 5))).toBe(0);
    expect(getAge("2026-10-04", at(2026, 10, 5))).toBe(0);
  });

  it("handles a DOB in 1970, where the old millisecond offset started counting", () => {
    expect(getAge("1970-01-01", at(2020, 1, 1))).toBe(50);
    expect(getAge("1970-01-02", at(2020, 1, 1))).toBe(49);
  });

  it("spans the epoch in the other direction without a negative age", () => {
    // A DOB after 1970 still gets a plain positive age; nothing here should return
    // a negative number or depend on the epoch at all.
    expect(getAge("2001-06-15", at(2026, 6, 15))).toBe(25);
  });

  describe("degrades to an empty string rather than a confident wrong number", () => {
    it("rejects a DOB in the future", () => {
      // The old implementation took Math.abs of the difference, so this reported 5.
      // A future DOB is a typo or a mis-mapped column, not a five-year-old.
      expect(getAge("2030-01-01", at(2025, 1, 1))).toBe("");
      // Future by year but an identical month and day: a stray century, e.g. 1925
      // where 2025 was meant.
      expect(getAge("2025-06-15", at(2024, 6, 15))).toBe("");
      // A DOB later today is still in the future while today is not over. `date` has
      // no time component, so a DOB stored as today is UTC midnight, which is the
      // start of today rather than the end of it.
      expect(getAge("2025-06-15", at(2025, 6, 14))).toBe("");
      expect(getAge("2025-06-15", at(2025, 6, 15, 0))).toBe(0);
    });

    it("rejects an unparseable DOB", () => {
      // `new Date("garbage")` does not throw, it returns Invalid Date, so the old
      // try/catch never fired and this rendered as "NaN yrs".
      expect(getAge("garbage", at(2025, 1, 1))).toBe("");
      expect(getAge("not-a-date", at(2025, 1, 1))).toBe("");
      // Well-formed but not a real calendar date.
      expect(getAge("1995-13-01", at(2025, 1, 1))).toBe("");
      expect(getAge("1995-01-32", at(2025, 1, 1))).toBe("");
    });

    it("treats a missing DOB as no age available", () => {
      expect(getAge("", at(2025, 1, 1))).toBe("");
      expect(getAge(null, at(2025, 1, 1))).toBe("");
      expect(getAge(undefined, at(2025, 1, 1))).toBe("");
    });
  });

  it("returns a number for a usable DOB, so callers can rely on the type", () => {
    expect(typeof getAge("1995-06-15", at(2025, 1, 1))).toBe("number");
    expect(typeof getAge("", at(2025, 1, 1))).toBe("string");
  });

  it("is a pure function of its arguments", () => {
    const now = at(2025, 6, 15);
    expect(getAge("1995-06-15", now)).toBe(getAge("1995-06-15", now));
  });
});
