import { CLINIC_TEST_CATALOG, type ClinicTestCatalogItem } from "@/lib/constants";

export type DetectedClinicTest = Pick<ClinicTestCatalogItem, "id" | "label">;

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function detectRequestedTests(ocrText: string): DetectedClinicTest[] {
  const normalizedText = normalizeText(ocrText);

  if (!normalizedText) {
    return [];
  }

  return CLINIC_TEST_CATALOG.filter((test) =>
    test.aliases.some((alias) => normalizedText.includes(normalizeText(alias)))
  ).map(({ id, label }) => ({ id, label }));
}

export function selectDetectedTests(
  detectedTests: DetectedClinicTest[],
  selectedIds?: string[]
) {
  if (!selectedIds) {
    return detectedTests;
  }

  const selectedIdSet = new Set(selectedIds);
  return detectedTests.filter((test) => selectedIdSet.has(test.id));
}
