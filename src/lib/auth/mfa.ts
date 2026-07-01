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
