import { LAB_REFERENCE_RANGES } from "@/lib/constants";

export interface ValidatedLabResult {
  test_value: string;
  unit: string | null;
  reference_range_min: number;
  reference_range_max: number;
  is_flagged: boolean;
}

const STRICT_NUMBER_REGEX = /^-?\d+(\.\d+)?$/;

export function validateLabResult(
  testName: string,
  rawValue: unknown,
  gender: string | null | undefined
): ValidatedLabResult {
  const range = LAB_REFERENCE_RANGES.find((ref) => ref.parameter === testName);
  if (!range) {
    throw new Error(`Reference range is not configured for ${testName}.`);
  }

  const value = String(rawValue ?? "").trim();
  if (!STRICT_NUMBER_REGEX.test(value)) {
    throw new Error(`Invalid numeric value for ${testName}. Enter a valid number before saving.`);
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`Invalid numeric value for ${testName}. Enter a valid number before saving.`);
  }

  const isFemale = gender?.toLowerCase() === "female";
  const min = isFemale ? range.femaleMin : range.maleMin;
  const max = isFemale ? range.femaleMax : range.maleMax;

  return {
    test_value: value,
    unit: range.unit,
    reference_range_min: min,
    reference_range_max: max,
    is_flagged: numericValue < min || numericValue > max,
  };
}
