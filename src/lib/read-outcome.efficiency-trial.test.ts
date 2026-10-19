import { describe, expect, it } from "vitest";
import { classifyRead } from "./read-outcome";

/**
 * `classifyRead` decides success from the *error* half of a PostgREST result,
 * never by truthiness of `data`. These cases pin that down, because the habit
 * it replaces -- `if (error || !data)` -- silently turns a legitimate `0`,
 * `false` or `""` into "no result", and turns a falsy error into success.
 */
describe("classifyRead: falsy values are classified by the error, not by truthiness", () => {
  const successfulFalsyValues = [0, false, "", null, undefined] as const;
  const nullishErrors = [null, undefined] as const;

  it.each(
    nullishErrors.flatMap((error) =>
      successfulFalsyValues.map((data) => ({ data, error, label: `${String(data)}/${String(error)}` }))
    )
  )("preserves successful data $label as ok", ({ data, error }) => {
    const outcome = classifyRead({ data, error });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.data).toBe(data);
    }
  });

  it.each([false, 0, ""] as const)("treats falsy error %j as a failure", (error) => {
    const outcome = classifyRead({ data: "row", error });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.error).toBe(error);
    }
  });
});
