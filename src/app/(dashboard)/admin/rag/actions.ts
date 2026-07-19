"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { revalidatePath } from "next/cache";
import { hasPermission } from "@/lib/auth/helpers";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

type BatchEmbedContentFn = (req: {
  requests: Array<{
    content: { role: string; parts: Array<{ text: string }> };
    outputDimensionality: number;
  }>;
}) => Promise<{ embeddings: Array<{ values: number[] }> }>;

/**
 * Splits text into chunks of specified size and overlap.
 */
function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks.length > 0 ? chunks : [text];
}

/**
 * Validates that current user is an admin.
 */
async function verifyAdmin() {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("Unauthorized: Please log in.");
  }
  
  const allowed = await hasPermission(user.id, "rag_documents.manage");
  if (!allowed) {
    throw new Error("Forbidden: Access denied.");
  }
  
  return user;
}

/**
 * Action to upload plain text and chunk/embed it.
 */
export async function uploadRagTextAction(title: string, content: string) {
  try {
    const user = await verifyAdmin();
    
    if (!title || !content) {
      return { success: false, error: "Title and content are required." };
    }
    
    const documentId = crypto.randomUUID();
    const chunks = chunkText(content);
    const adminSupabase = createAdminClient();
    
    // Note: text-embedding-004 is requested by spec, but returned 404 in this environment's Gemini API.
    // We use gemini-embedding-001 with outputDimensionality: 768 to achieve the correct 768-dim vector size.
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    
    const embeddings: number[][] = [];
    const batchSize = 100;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const chunkBatch = chunks.slice(i, i + batchSize);
      const batchResult = await (embeddingModel.batchEmbedContents as unknown as BatchEmbedContentFn)({
        requests: chunkBatch.map((chunk) => ({
          content: { role: "user", parts: [{ text: chunk }] },
          outputDimensionality: 768,
        })),
      });
      if (!batchResult.embeddings) {
        throw new Error("Failed to generate batch embeddings.");
      }
      embeddings.push(...batchResult.embeddings.map((e) => e.values));
    }
    
    const rows = chunks.map((chunk, idx) => ({
      title,
      content: chunk,
      embedding: embeddings[idx],
      metadata: {
        document_id: documentId,
        chunk_index: idx,
        total_chunks: chunks.length,
        source_type: "text",
      }
    }));
    
    const { error } = await adminSupabase.from("rag_documents").insert(rows);
    if (error) throw error;
    
    await logEvent(
      adminSupabase,
      user.id,
      SYSTEM_EVENT_TYPES.RAG_DOCUMENT_UPLOADED,
      `Uploaded text document "${title}" (${chunks.length} chunks)`,
      null,
      { document_id: documentId, title, type: "text" }
    );
    
    revalidatePath("/admin/rag");
    return { success: true };
  } catch (err) {
    console.error("Text upload error:", err);
    const message = err instanceof Error ? err.message : "Failed to upload text.";
    return { success: false, error: message };
  }
}

/**
 * Action to upload a PDF, extract its text via Gemini 2.5 Flash, chunk, and embed it.
 */
export async function uploadRagPdfAction(formData: FormData) {
  try {
    const user = await verifyAdmin();
    const file = formData.get("file") as File;
    if (!file || file.size === 0) {
      return { success: false, error: "No file provided." };
    }
    
    // Enforce 10MB maximum file size
    if (file.size > 10 * 1024 * 1024) {
      return { success: false, error: "File size exceeds the 10MB limit." };
    }
    
    // Validate MIME type
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return { success: false, error: "Only PDF files are accepted." };
    }
    
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Extract text using Gemini 2.5 Flash
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent([
      {
        inlineData: {
          data: buffer.toString("base64"),
          mimeType: "application/pdf"
        }
      },
      "Extract all clinical, medical, administrative, and schedule text verbatim from this document. Do not summarize, alter, or omit any details. Format it as clean markdown."
    ]);
    
    const extractedText = result.response.text();
    if (!extractedText || extractedText.trim().length < 50) {
      return { success: false, error: "The extracted text is too short or empty. Please ensure the PDF has a readable text layer." };
    }
    
    const documentId = crypto.randomUUID();
    const chunks = chunkText(extractedText);
    const adminSupabase = createAdminClient();
    
    // Note: text-embedding-004 is requested by spec, but returned 404 in this environment's Gemini API.
    // We use gemini-embedding-001 with outputDimensionality: 768 to achieve the correct 768-dim vector size.
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    
    const embeddings: number[][] = [];
    const batchSize = 100;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const chunkBatch = chunks.slice(i, i + batchSize);
      const batchResult = await (embeddingModel.batchEmbedContents as unknown as BatchEmbedContentFn)({
        requests: chunkBatch.map((chunk) => ({
          content: { role: "user", parts: [{ text: chunk }] },
          outputDimensionality: 768,
        })),
      });
      if (!batchResult.embeddings) {
        throw new Error("Failed to generate batch embeddings.");
      }
      embeddings.push(...batchResult.embeddings.map((e) => e.values));
    }
    
    const rows = chunks.map((chunk, idx) => ({
      title: file.name,
      content: chunk,
      embedding: embeddings[idx],
      metadata: {
        document_id: documentId,
        chunk_index: idx,
        total_chunks: chunks.length,
        source_type: "pdf",
      }
    }));
    
    const { error } = await adminSupabase.from("rag_documents").insert(rows);
    if (error) throw error;
    
    await logEvent(
      adminSupabase,
      user.id,
      SYSTEM_EVENT_TYPES.RAG_DOCUMENT_UPLOADED,
      `Uploaded PDF document "${file.name}" (${chunks.length} chunks)`,
      null,
      { document_id: documentId, title: file.name, type: "pdf" }
    );
    
    revalidatePath("/admin/rag");
    return { success: true };
  } catch (err) {
    console.error("PDF upload error:", err);
    const message = err instanceof Error ? err.message : "Failed to process PDF.";
    return { success: false, error: message };
  }
}

/**
 * Action to delete a RAG document and all its chunks.
 */
export async function deleteRagDocumentAction(documentId: string) {
  try {
    const user = await verifyAdmin();
    if (!documentId) {
      return { success: false, error: "Document ID is required." };
    }
    
    const adminSupabase = createAdminClient();
    
    // Retrieve title of document first
    const { data: chunks, error: selectError } = await adminSupabase
      .from("rag_documents")
      .select("title")
      .eq("metadata->>document_id", documentId)
      .limit(1);
      
    if (selectError) throw selectError;
    const docTitle = chunks && chunks.length > 0 ? chunks[0].title : "Unknown Document";
    
    const { error: deleteError } = await adminSupabase
      .from("rag_documents")
      .delete()
      .eq("metadata->>document_id", documentId);
      
    if (deleteError) throw deleteError;
    
    await logEvent(
      adminSupabase,
      user.id,
      SYSTEM_EVENT_TYPES.RAG_DOCUMENT_DELETED,
      `Deleted RAG document "${docTitle}"`,
      null,
      { document_id: documentId, title: docTitle }
    );
    
    revalidatePath("/admin/rag");
    return { success: true };
  } catch (err) {
    console.error("Delete RAG document error:", err);
    const message = err instanceof Error ? err.message : "Failed to delete document.";
    return { success: false, error: message };
  }
}
