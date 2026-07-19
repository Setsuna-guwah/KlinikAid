"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { hasPermission } from "@/lib/auth/helpers";

/**
 * Generate a short-lived signed URL for a private document file.
 * Restricts access to the owning patient or clinic staff/admin.
 * Always verifies ownership against the DB record before generating.
 */
export async function getSignedUrlAction(documentId: string) {
  // Standing Rule 1: supabase.auth.getUser() first line
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized: Please log in." };
  }

  // 1. Fetch document record
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("file_path, patient_id, uploader_id")
    .eq("id", documentId)
    .single();

  if (docError || !doc) {
    return { success: false, error: "Document not found." };
  }

  // 2. Fetch user role to verify access permissions
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const canManageDocuments = profile ? await hasPermission(user.id, "documents.manage") : false;

  // Fetch patient record if not staff/admin to verify ownership
  let isOwner = false;
  if (!canManageDocuments) {
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("profile_id", user.id)
      .single();

    isOwner = (patient && doc.patient_id === patient.id) || doc.uploader_id === user.id;
  }

  // Prevent unauthorized access
  if (!canManageDocuments && !isOwner) {
    return { success: false, error: "Access Denied: You do not have permission to view this file." };
  }

  // Create signed URL valid for 300 seconds (5 minutes) for better slow network UX
  const { data, error } = await supabase.storage
    .from("patient-documents")
    .createSignedUrl(doc.file_path, 300);

  if (error || !data?.signedUrl) {
    console.error("[getSignedUrlAction] Error creating signed URL:", error);
    return { success: false, error: "Failed to generate file access link." };
  }

  return { success: true, signedUrl: data.signedUrl };
}

/**
 * Deletes a pending document submission and removes its associated file from private storage.
 * Deletes DB record first to prevent orphaned references, and gates by status = 'pending'.
 */
export async function deletePendingDocumentAction(docId: string) {
  // Standing Rule 1: supabase.auth.getUser() first line
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized: Please log in." };
  }

  // 1. Fetch patient record for ownership check
  const { data: patient } = await supabase
    .from("patients")
    .select("id")
    .eq("profile_id", user.id)
    .single();

  if (!patient) {
    return { success: false, error: "Patient profile not found." };
  }

  // 2. Fetch document details to verify status and ownership
  const { data: doc, error: fetchError } = await supabase
    .from("documents")
    .select("file_path, status, patient_id, uploader_id")
    .eq("id", docId)
    .maybeSingle();

  if (fetchError) {
    console.error("[deletePendingDocumentAction] Document lookup error:", fetchError);
    return { success: false, error: "Document not found." };
  }

  if (!doc) {
    revalidatePath("/patient/submissions");
    revalidatePath("/patient/dashboard");
    return { success: true };
  }

  const isOwner = doc.patient_id === patient.id || doc.uploader_id === user.id;
  if (!isOwner) {
    return { success: false, error: "Access Denied: You do not own this document." };
  }

  // Enforce status check: only pending documents can be deleted
  if (doc.status !== "pending") {
    return { success: false, error: "Only pending documents can be cancelled or deleted." };
  }

  // Step 1: Delete DB row first and verify the row was actually removed.
  const { data: deletedDoc, error: dbDeleteError } = await supabase
    .from("documents")
    .delete()
    .eq("id", docId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (dbDeleteError || !deletedDoc) {
    console.error("[deletePendingDocumentAction] Database delete error:", dbDeleteError);
    return { success: false, error: "Failed to delete document record." };
  }

  // Step 2: Only delete storage if DB succeeded
  const { error: storageDeleteError } = await supabase.storage
    .from("patient-documents")
    .remove([doc.file_path]);

  if (storageDeleteError) {
    console.error("[deletePendingDocumentAction] Storage file cleanup failed:", storageDeleteError);
  }

  revalidatePath("/patient/submissions");
  revalidatePath("/patient/dashboard");

  return { success: true };
}
