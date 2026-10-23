import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LAB_REFERENCE_RANGES } from "@/lib/constants";

/**
 * Issue #204: the plausibility limits are seeded into
 * `public.lab_plausibility_limits` by `src/lib/db/migration_40.sql`, hand-
 * written as SQL, while `src/lib/constants.ts` stays the source of truth the
 * two clients validate against. Nothing re-checks that the two agree once the
 * file has been written, and a migration that has already been applied is not
 * re-read by the app at all -- a drift here would silently move the server's
 * rule away from the clients'.
 *
 * So this parses the migration text (no database) and compares it to the
 * constants, in both places the limits are written down: the seed, and the
 * pre-flight query the operator runs before applying. It also pins the number
 * regex, which the migration carries verbatim from `validateLabResult.ts`.
 */

const MIGRATION_PATH = new URL("./migration_40.sql", import.meta.url);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, "utf8");
const VALIDATOR_TS = readFileSync(new URL("../records/validateLabResult.ts", import.meta.url), "utf8");

/**
 * `('Hemoglobin', 1, 25, 'g/dL')` -- the tuple shape used by both the seed's
 * INSERT and the pre-flight's inline VALUES list, and by nothing else: the
 * migration's other quoted strings are never followed by two numbers.
 */
const LIMIT_TUPLE =
  /\(\s*'([^']+)'\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*'([^']+)'\s*\)/g;

const EXPECTED = LAB_REFERENCE_RANGES.map(
  (range) => `${range.parameter}|${range.plausibleMin}|${range.plausibleMax}|${range.unit}`
);

/** Tuples of one comment state: commented lines are the pre-flight query. */
function tuplesByCommentState(sql: string): { commented: string[]; active: string[] } {
  const commented: string[] = [];
  const active: string[] = [];
  for (const line of sql.split("\n")) {
    const target = /^\s*--/.test(line) ? commented : active;
    for (const match of line.matchAll(LIMIT_TUPLE)) {
      target.push(`${match[1]}|${match[2]}|${match[3]}|${match[4]}`);
    }
  }
  return { commented, active };
}

describe("migration_40 lab plausibility limits", () => {
  const { commented, active } = tuplesByCommentState(MIGRATION_SQL);

  it("seeds exactly the limits constants.ts declares", () => {
    expect(new Set(active)).toEqual(new Set(EXPECTED));
    expect(active).toHaveLength(EXPECTED.length);
  });

  it("pre-flights against the same limits, so the count before applying is the rule after", () => {
    expect(new Set(commented)).toEqual(new Set(EXPECTED));
    expect(commented).toHaveLength(EXPECTED.length);
  });

  it("checks nothing beyond the parameters in LAB_REFERENCE_RANGES", () => {
    // Two copies of every tuple in the file (pre-flight + seed) and no third
    // list drifting somewhere else.
    expect(active.length + commented.length).toBe(EXPECTED.length * 2);
  });

  it("carries validateLabResult's number regex verbatim, wherever it appears", () => {
    const declared = VALIDATOR_TS.match(/const STRICT_NUMBER_REGEX = (\/.*\/);/);
    expect(declared, "STRICT_NUMBER_REGEX not found in validateLabResult.ts").not.toBeNull();

    const patterns = [...MIGRATION_SQL.matchAll(/~ '([^']*)'/g)].map((match) => match[1]);
    expect(patterns.length).toBeGreaterThan(0);
    expect(new Set(patterns)).toEqual(new Set([declared![1].slice(1, -1)]));
  });
});
