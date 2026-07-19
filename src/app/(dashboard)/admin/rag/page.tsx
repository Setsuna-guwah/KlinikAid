import { redirect } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import RagManagerClient from "@/components/RagManagerClient";

export const dynamic = "force-dynamic";

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
  
  const supabase = createClient();
  const { data, error } = await supabase
    .from("rag_documents")
    .select("id, title, content, metadata, created_at")
    .order("created_at", { ascending: false });
    
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
  
  const rows = (data as unknown as RagDocumentRow[]) || [];
  
  rows.forEach((row) => {
    const metadata = row.metadata || {};
    const docId = metadata.document_id || row.id;
    const length = row.content ? row.content.length : 0;
    
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
  
  const documents = Object.values(grouped);
  
  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
            RAG Knowledge Base
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            Manage clinical guidelines, documents, and reference sheets used to ground the AI Chatbot responses.
          </p>
        </div>
        
        <RagManagerClient initialDocuments={documents} />
      </div>
    </div>
  );
}
