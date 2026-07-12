import { GoogleGenerativeAI } from "@google/generative-ai";
import { WEB_OCR_ENABLED } from "@/lib/constants";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export interface DocumentTextExtractionResult {
  text: string | null;
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

/**
 * Pluggable document text extraction using Gemini 2.5 Flash.
 * Gated by WEB_OCR_ENABLED constant.
 * Supports PDF, JPEG, and PNG files.
 *
 * @param fileBuffer The raw Buffer of the uploaded file
 * @param mimeType The file's mime type (e.g. application/pdf, image/jpeg, image/png)
 * @returns Extraction text and token usage, or null if disabled or no Gemini response was received
 */
export async function extractDocumentText(
  fileBuffer: Buffer,
  mimeType: string
): Promise<DocumentTextExtractionResult | null> {
  if (!WEB_OCR_ENABLED) {
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent([
      {
        inlineData: {
          data: fileBuffer.toString("base64"),
          mimeType: mimeType
        }
      },
      "Extract all clinical, medical, administrative, and schedule text verbatim from this document. Do not summarize, alter, or omit any details. Format it as clean markdown."
    ]);

    const usageMetadata = result.response.usageMetadata;
    let extractedText: string | null = null;

    try {
      extractedText = result.response.text() || null;
    } catch (textError) {
      console.error("[extractDocumentText] Gemini response contained no extractable text:", textError);
    }

    return {
      text: extractedText,
      promptTokenCount: usageMetadata?.promptTokenCount ?? 0,
      candidatesTokenCount: usageMetadata?.candidatesTokenCount ?? 0,
      totalTokenCount: usageMetadata?.totalTokenCount ?? 0,
    };
  } catch (error) {
    console.error("[extractDocumentText] OCR extraction failed:", error);
    return null;
  }
}
