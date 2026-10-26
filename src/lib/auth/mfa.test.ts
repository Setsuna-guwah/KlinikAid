import { describe, expect, it, vi } from "vitest";
import { findOwnedTotpFactor, staffMfaStep, type MfaFactor } from "./mfa";

/**
 * Shapes follow supabase-js `listFactors`: every factor goes in `all`, but only
 * verified ones are copied into `totp`/`phone`. A factor mid-enrolment is
 * therefore visible in `all` alone.
 */
const UNVERIFIED = { id: "81f066f7", status: "unverified", factor_type: "totp" };
const VERIFIED = { id: "a1b2c3d4", status: "verified", factor_type: "totp" };

describe("findOwnedTotpFactor", () => {
  it("finds a factor still being enrolled (unverified, listed only in `all`)", () => {
    const factors = { all: [UNVERIFIED], totp: [], phone: [] };
    expect(findOwnedTotpFactor(factors, UNVERIFIED.id)).toEqual(UNVERIFIED);
  });

  it("finds an already-verified factor", () => {
    const factors = { all: [VERIFIED], totp: [VERIFIED], phone: [] };
    expect(findOwnedTotpFactor(factors, VERIFIED.id)).toEqual(VERIFIED);
  });

  it("rejects an id that is not among the caller's factors", () => {
    const factors = { all: [UNVERIFIED, VERIFIED], totp: [VERIFIED], phone: [] };
    expect(findOwnedTotpFactor(factors, "someone-elses-factor")).toBeUndefined();
  });

  it("rejects a non-TOTP factor with a matching id", () => {
    const phone = { id: "p1", status: "unverified", factor_type: "phone" };
    expect(findOwnedTotpFactor({ all: [phone], totp: [], phone: [] }, phone.id)).toBeUndefined();
  });

  it("returns undefined when no factors are available", () => {
    expect(findOwnedTotpFactor(null, UNVERIFIED.id)).toBeUndefined();
  });
});

describe("staffMfaStep", () => {
  const listed = (factors: MfaFactor[]) => async () => ({
    data: { all: factors, totp: factors.filter((f) => f.status === "verified"), phone: [] },
    error: null,
  });

  it("lets an aal2 session through without listing factors", async () => {
    const listFactors = vi.fn(listed([]));
    await expect(staffMfaStep("aal2", listFactors)).resolves.toBe("continue");
    expect(listFactors).not.toHaveBeenCalled();
  });

  it("sends an aal1 session with a verified factor back to sign-in", async () => {
    await expect(staffMfaStep("aal1", listed([VERIFIED]))).resolves.toBe("mfa_required");
  });

  it("sends an aal1 session with no verified factor to enrolment", async () => {
    await expect(staffMfaStep("aal1", listed([UNVERIFIED]))).resolves.toBe("enroll");
  });

  it("treats a missing aal claim as not verified, so it cannot pass as aal2", async () => {
    const listFactors = vi.fn(listed([VERIFIED]));
    await expect(staffMfaStep(null, listFactors)).resolves.toBe("mfa_required");
    expect(listFactors).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the factor list is an error rather than an empty answer", async () => {
    const failed = async () => ({ data: null, error: new Error("auth unavailable") });
    await expect(staffMfaStep("aal1", failed)).resolves.toBe("check_failed");
  });

  it("fails closed when listing the factors throws", async () => {
    const boom = async () => {
      throw new Error("network");
    };
    await expect(staffMfaStep("aal1", boom)).resolves.toBe("check_failed");
  });
});
