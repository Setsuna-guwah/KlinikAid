export type MfaFactor = {
  id: string;
  status?: string;
  factor_type?: string;
};

type MfaFactorsResponse = {
  all?: MfaFactor[];
  totp?: MfaFactor[];
  phone?: MfaFactor[];
};

export function getTotpFactors(factors: MfaFactorsResponse | null | undefined): MfaFactor[] {
  const directTotp = Array.isArray(factors?.totp) ? factors.totp : [];
  const allTotp = Array.isArray(factors?.all)
    ? factors.all.filter((factor) => factor.factor_type === "totp")
    : [];
  const byId = new Map<string, MfaFactor>();

  for (const factor of [...directTotp, ...allTotp]) {
    byId.set(factor.id, factor);
  }

  return Array.from(byId.values());
}

export function getPhoneFactors(factors: MfaFactorsResponse | null | undefined): MfaFactor[] {
  return Array.isArray(factors?.phone) ? factors.phone : [];
}

/**
 * What a staff session must do before it may enter the dashboard.
 *
 * - `continue`: the session may proceed.
 * - `enroll`: the account has no verified factor, so it must enrol one.
 * - `mfa_required`: the account has a verified factor but this session did not
 *   use it (not aal2). The caller ends the session and sends it to sign-in.
 * - `check_failed`: the factors could not be read, so the gate fails closed.
 */
export type StaffMfaStep = "continue" | "enroll" | "mfa_required" | "check_failed";

/**
 * The staff MFA gate, decided from the session's assurance level first.
 *
 * `aal2` is only issued after a verified factor has answered its challenge,
 * so an `aal2` claim in the locally verified token already proves the account
 * has a factor and that this session used it. The factor list (a round trip to
 * the Auth server) is only read when the claim says otherwise, where the
 * outcome still depends on whether the account has a factor at all.
 *
 * `listFactors` is passed in so the decision stays free of the Supabase client.
 */
export async function staffMfaStep(
  aal: string | null | undefined,
  listFactors: () => PromiseLike<{ data: MfaFactorsResponse | null; error: unknown }>
): Promise<StaffMfaStep> {
  if (aal === "aal2") {
    return "continue";
  }

  let factors: MfaFactorsResponse | null;
  try {
    const { data, error } = await listFactors();
    // A failed listing is not an empty one: it must not be read as "no factor".
    if (error) return "check_failed";
    factors = data;
  } catch (error) {
    console.error("MFA Gate threw listing factors:", error);
    return "check_failed";
  }

  if (!getTotpFactors(factors).some((factor) => factor.status === "verified")) {
    return "enroll";
  }

  // A verified factor proves the account can use a second factor; the session's
  // own assurance level (not aal2 here) proves this session did not.
  return "mfa_required";
}

/**
 * Finds the caller's TOTP factor with this id, whatever its status.
 *
 * `listFactors` only returns the caller's own factors, so an id match is the
 * ownership proof. Status must not be part of the match: during enrolment the
 * factor is `unverified` until `mfa.verify` succeeds, and it only appears in
 * `all` (supabase-js puts verified factors alone in `totp`).
 */
export function findOwnedTotpFactor(
  factors: MfaFactorsResponse | null | undefined,
  factorId: string,
): MfaFactor | undefined {
  return getTotpFactors(factors).find((factor) => factor.id === factorId);
}
