import { describe, expect, it } from "vitest";
import {
  dataLoadErrorDescription,
  type DataLoadErrorKind,
} from "./data-load-error-copy";

describe("dataLoadErrorDescription", () => {
  it("keeps the list wording byte-for-byte (surfaces already showing it depend on it)", () => {
    expect(dataLoadErrorDescription("list")).toBe(
      "This list is empty because the request failed, not because there is nothing to show. Nothing below this message can be trusted until it loads.",
    );
  });

  it("never tells a non-list surface that its list is empty", () => {
    // Regression for #214: /reception/queue/<bad uuid> showed the list
    // default under "Could not load this document".
    for (const kind of ["record", "page"] as const) {
      expect(dataLoadErrorDescription(kind)).not.toMatch(/list/i);
    }
  });

  it("keeps every kind's claim inside what a failed read supports", () => {
    // A failed read neither empties a list nor proves a record's existence,
    // and dashboards render loaded data beside the error.
    const record = dataLoadErrorDescription("record");
    expect(record).toMatch(/does not establish whether it exists/i);
    expect(record).not.toMatch(/does not exist/i);
    expect(dataLoadErrorDescription("page")).toMatch(
      /data affected by the failed request cannot be trusted/i,
    );
    for (const kind of ["list", "record", "page"] as const) {
      expect(dataLoadErrorDescription(kind)).toMatch(/trusted until it loads/i);
    }
  });

  it("gives every kind its own non-empty copy", () => {
    const kinds: DataLoadErrorKind[] = ["list", "record", "page"];
    const descriptions = kinds.map(dataLoadErrorDescription);
    for (const description of descriptions) {
      expect(description.length).toBeGreaterThan(0);
    }
    expect(new Set(descriptions).size).toBe(kinds.length);
  });
});
