import React from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import DocumentApprovalClient from "@/components/DocumentApprovalClient";
import { Document } from "@/types";

export const dynamic = "force-dynamic";

interface DocumentDetailsPageProps {
  params: {
    documentId: string;
  };
}

export default async function DocumentDetailsPage({ params }: DocumentDetailsPageProps) {
  // 1. Authenticate user and enforce receptionist/admin roles (Rule 1 & Rule 2)
  await requirePermission("documents.manage");
  const supabase = createClient();
  const { documentId } = params;

  // 2. Fetch document with patient and uploader profiles
  const { data: rawDoc, error } = await supabase
    .from("documents")
    .select(`
      *,
      patient:patient_id (
        id,
        first_name,
        last_name,
        date_of_birth,
        gender,
        contact_number,
        email,
        address
      ),
      uploader:uploader_id (
        id,
        full_name,
        role
      )
    `)
    .eq("id", documentId)
    .single();

  if (error || !rawDoc) {
    console.error(`Error fetching document details for ID ${documentId}:`, error);
    return notFound();
  }

  const document = rawDoc as Document;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Document Validation
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Verify extracted referral metadata, view parameters, and triage the patient
        </p>
      </div>

      {/* Main Validation View */}
      <DocumentApprovalClient document={document} />
    </div>
  );
}
