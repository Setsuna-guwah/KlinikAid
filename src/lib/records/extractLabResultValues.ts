import { GoogleGenerativeAI } from "@google/generative-ai";
import { LAB_TEST_GROUPS, LabTestPanel, WEB_OCR_ENABLED } from "@/lib/constants";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const STRICT_NUMBER_REGEX = /^-?\d+(\.\d+)?$/;

export interface LabValueExtractionResult {
  panel: LabTestPanel | null;
  values: Partial<Record<(typeof LAB_TEST_GROUPS)[LabTestPanel][number], string>>;
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

const LAB_VALUE_EXTRACTION_PROMPT = `You are extracting numeric laboratory result values from a clinic result sheet.
Return ONLY valid JSON. Do not include markdown, explanations, comments, or extra text.

Allowed panels and parameters:
- Complete Blood Count (CBC): Hemoglobin, White Blood Cells (WBC), Platelets
- Fasting Blood Sugar (FBS): Fasting Blood Sugar (FBS)
- Renal Function: Creatinine
- Lipid Profile: Cholesterol

Task:
1. Identify the most likely panel from the allowed list.
2. Extract only numeric result values for allowed parameters.
3. Preserve decimal points. Do not include units. Do not infer missing values.
4. If a value is unclear, missing, unreadable, or ambiguous, omit that parameter.
5. If no allowed lab values are readable, return {"panel": null, "values": {}}.

Expected JSON shape:
{"panel":"Complete Blood Count (CBC)","values":{"Hemoglobin":"14.2","White Blood Cells (WBC)":"7.1","Platelets":"250"}}`;

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (fenced?.[1] || trimmed).trim();
}

function isLabTestPanel(value: unknown): value is LabTestPanel {
  return typeof value === "string" && value in LAB_TEST_GROUPS;
}

function sanitizeExtractedValues(panel: LabTestPanel | null, rawValues: unknown) {
  if (!panel || !rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) {
    return {};
  }

  const allowedParams = new Set<string>(LAB_TEST_GROUPS[panel]);
  const sanitized: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(rawValues)) {
    if (!allowedParams.has(key)) continue;

    const value = String(rawValue ?? "").trim();
    if (!STRICT_NUMBER_REGEX.test(value)) continue;

    sanitized[key] = value;
  }

  return sanitized;
}

export async function extractLabResultValues(
  fileBuffer: Buffer,
  mimeType: string
): Promise<LabValueExtractionResult | null> {
  if (!WEB_OCR_ENABLED) {
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent([
      {
        inlineData: {
          data: fileBuffer.toString("base64"),
          mimeType,
        },
      },
      LAB_VALUE_EXTRACTION_PROMPT,
    ]);

    const usageMetadata = result.response.usageMetadata;
    let responseText = "";

    try {
      responseText = result.response.text() || "";
    } catch (textError) {
      console.error("[extractLabResultValues] Gemini response contained no extractable text:", textError);
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(responseText));
    } catch (parseError) {
      console.error("[extractLabResultValues] Failed to parse structured Gemini response:", parseError);
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const payload = parsed as { panel?: unknown; values?: unknown };
    const panel = isLabTestPanel(payload.panel) ? payload.panel : null;
    const values = sanitizeExtractedValues(panel, payload.values);

    return {
      panel,
      values,
      promptTokenCount: usageMetadata?.promptTokenCount ?? 0,
      candidatesTokenCount: usageMetadata?.candidatesTokenCount ?? 0,
      totalTokenCount: usageMetadata?.totalTokenCount ?? 0,
    };
  } catch (error) {
    console.error("[extractLabResultValues] Lab value extraction failed:", error);
    return null;
  }
}
