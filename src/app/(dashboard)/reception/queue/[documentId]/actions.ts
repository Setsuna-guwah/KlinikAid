"use server";

import { createClient } from "@/lib/supabase/server";

export async function getReceptionDocumentSignedUrlAction(documentId: string) {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized: Please log in." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || !["admin", "receptionist"].includes(profile.role)) {
    return { success: false, error: "Access denied." };
  }

  const { data: document, error: documentError } = await supabase
    .from("documents")
    .select("file_path")
    .eq("id", documentId)
    .single();

  if (documentError || !document) {
    return { success: false, error: "Document not found." };
  }

  const { data, error } = await supabase.storage
    .from("patient-documents")
    .createSignedUrl(document.file_path, 300);

  if (error || !data?.signedUrl) {
    console.error("[getReceptionDocumentSignedUrlAction] Error creating signed URL:", {
      error,
      documentId,
      filePath: document.file_path,
    });
    if (error && "statusCode" in error && error.statusCode === "404") {
      return {
        success: false,
        error: "File is missing from secure storage. The document record exists, but its uploaded file could not be found.",
      };
    }

    return { success: false, error: "Failed to generate file access link." };
  }

  return { success: true, signedUrl: data.signedUrl };
}
