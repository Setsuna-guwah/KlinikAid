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

  it("still says the failure is a failed load, not an empty or missing result", () => {
    for (const kind of ["list", "record", "page"] as const) {
      const description = dataLoadErrorDescription(kind);
      expect(description).toMatch(/not because/i);
      expect(description).toMatch(/trusted/i);
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
