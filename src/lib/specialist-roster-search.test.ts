import { describe, expect, it } from "vitest";
import { isLocallySearchable, rosterMatchesText } from "./specialist-roster-search";

const ana = { first_name: "Ana", last_name: "Dela Cruz" };

describe("isLocallySearchable", () => {
  it("accepts an empty query, which is the whole roster", () => {
    expect(isLocallySearchable("")).toBe(true);
    expect(isLocallySearchable("   ")).toBe(true);
  });

  it("accepts plain names, including spaces, apostrophes and hyphens", () => {
    expect(isLocallySearchable("Ana")).toBe(true);
    expect(isLocallySearchable("dela cruz")).toBe(true);
    expect(isLocallySearchable("O'Neil-Smith")).toBe(true);
  });

  it("sends anything the server's filter would read as wildcard or grammar to the server", () => {
    expect(isLocallySearchable("a%")).toBe(false);
    expect(isLocallySearchable("a_b")).toBe(false);
    expect(isLocallySearchable("a,b")).toBe(false);
    expect(isLocallySearchable("(a)")).toBe(false);
    expect(isLocallySearchable("a.b")).toBe(false);
  });

  it("sends patient-code searches to the server, which matches the id", () => {
    expect(isLocallySearchable("PT-1234")).toBe(false);
    expect(isLocallySearchable("pt-")).toBe(false);
  });
});

describe("rosterMatchesText", () => {
  it("matches a first name or a last name, ignoring case", () => {
    expect(rosterMatchesText(ana, "ana")).toBe(true);
    expect(rosterMatchesText(ana, "CRUZ")).toBe(true);
  });

  it("matches a substring of a name, as the server's ilike does", () => {
    expect(rosterMatchesText(ana, "el")).toBe(true);
  });

  it("does not match across the first and last name", () => {
    // The server searches each column on its own, so a full name is one substring.
    expect(rosterMatchesText(ana, "ana dela")).toBe(false);
  });

  it("does not match a name that is absent", () => {
    expect(rosterMatchesText(ana, "bob")).toBe(false);
  });

  it("matches every patient for an empty query", () => {
    expect(rosterMatchesText(ana, "")).toBe(true);
  });
});
