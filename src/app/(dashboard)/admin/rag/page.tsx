import { redirect } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import RagManagerClient from "@/components/RagManagerClient";
import PageHeader from "@/components/PageHeader";
import { timed } from "@/lib/perf/timing";
import { preloadRagDocuments, type RagDocumentContent } from "@/lib/rag/document-content";

export const dynamic = "force-dynamic";

/** PostgREST returns at most this many rows for one request, and says nothing when it stops. */
const POSTGREST_ROW_LIMIT = 1000;

interface GroupedDocument {
  documentId: string;
  title: string;
  sourceType: "text" | "pdf";
  chunkCount: number;
  totalLength: number;
  createdAt: string;
  /** The document's indexed text, when it was small enough to send with the list. */
  preloaded: RagDocumentContent | null;
}

interface RagDocumentRow {
  id: string;
  title: string;
  content: string;
  metadata: {
    document_id?: string;
    chunk_index?: number;
    total_chunks?: number;
    source_type?: "text" | "pdf";
  } | null;
  created_at: string;
}

export default async function RagPage() {
  const { user, profile } = await getCurrentUser();
  
  if (!user) {
    redirect("/login");
  }
  
  if (!profile || !(await hasPermission(user.id, "rag_documents.manage"))) {
    redirect("/403");
  }
  
  const supabase = await createClient();
  const { data, error } = await timed("page.rag.documents", () =>
    supabase
      .from("rag_documents")
      .select("id, title, content, metadata, created_at")
      .order("created_at", { ascending: false })
  );
    
  if (error) {
    console.error("Failed to fetch RAG documents:", error);
  }
  
  // Group chunks by document_id in metadata
  const grouped: Record<string, {
    documentId: string;
    title: string;
    sourceType: "text" | "pdf";
    chunkCount: number;
    totalLength: number;
    createdAt: string;
  }> = {};
  const rowsByDocument = new Map<string, RagDocumentRow[]>();
  
  const rows = (data as unknown as RagDocumentRow[]) || [];
  
  rows.forEach((row) => {
    const metadata = row.metadata || {};
    const docId = metadata.document_id || row.id;
    const length = row.content ? row.content.length : 0;

    const chunks = rowsByDocument.get(docId);
    if (chunks) chunks.push(row);
    else rowsByDocument.set(docId, [row]);
    
    if (!grouped[docId]) {
      grouped[docId] = {
        documentId: docId,
        title: row.title || "Untitled",
        sourceType: metadata.source_type || "text",
        chunkCount: 0,
        totalLength: 0,
        createdAt: row.created_at,
      };
    }
    
    grouped[docId].chunkCount += 1;
    grouped[docId].totalLength += length;
    
    // Maintain the earliest creation date
    if (new Date(row.created_at) < new Date(grouped[docId].createdAt)) {
      grouped[docId].createdAt = row.created_at;
    }
  });
  
  // Small documents carry their text, so opening one needs no second request.
  // The list was read in full only if it stayed under the row limit.
  const preloaded = preloadRagDocuments(rowsByDocument, {
    complete: rows.length < POSTGREST_ROW_LIMIT,
  });
  const documents: Array<GroupedDocument> = Object.values(grouped).map((doc) => ({
    ...doc,
    preloaded: preloaded.get(doc.documentId) ?? null,
  }));
  
  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-8">
        <PageHeader
          title="RAG Knowledge Base"
          description="Manage clinical guidelines, documents, and reference sheets used to ground the AI Chatbot responses."
        />
        
        <RagManagerClient initialDocuments={documents} error={error ? { message: error.message } : null} />
      </div>
    </div>
  );
}
