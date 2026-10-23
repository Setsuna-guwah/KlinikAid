import React from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import DocumentApprovalClient from "@/components/DocumentApprovalClient";
import DataLoadError from "@/components/DataLoadError";
import { Document } from "@/types";
import { classifyRead } from "@/lib/read-outcome";
import { reviewTemplateSubmission } from "@/lib/documents/templateChecks";

export const dynamic = "force-dynamic";

interface DocumentDetailsPageProps {
  params: Promise<{
    documentId: string;
  }>;
}

export default async function DocumentDetailsPage(props: DocumentDetailsPageProps) {
  const params = await props.params;
  // 1. Authenticate user and enforce receptionist/admin roles (Rule 1 & Rule 2)
  await requirePermission("documents.manage");
  const supabase = await createClient();
  const { documentId } = params;

  // 2. Fetch document with patient and uploader profiles
  const documentRead = classifyRead(await supabase
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
    .single());

  // Distinguish "this document does not exist" from "we could not load it".
  // Collapsing both into notFound() tells reception the document is absent
  // when it may exist and simply be unreachable -- and a referral they stop
  // looking for is a referral that never gets triaged. .single() reports zero
  // rows as a PGRST116 error, so classifyRead is what can tell the two apart.
  if (documentRead.kind === "failed") {
    console.error(`Error fetching document details for ID ${documentId}:`, documentRead.error);
    return (
      <div className="space-y-6">
        <DataLoadError
          what="this document"
          error={documentRead.error}
          retryHref={`/reception/queue/${documentId}`}
        />
      </div>
    );
  }

  if (documentRead.kind === "absent") {
    notFound();
  }

  const document = documentRead.data as Document;
  // Checked here, against what is stored, rather than trusted from submission
  // time: rows written before the submit-side bounds existed are re-checked too.
  const templateReview =
    document.file_type === "template" ? reviewTemplateSubmission(document.extracted_metadata) : null;

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
      <DocumentApprovalClient document={document} templateReview={templateReview} />
    </div>
  );
}
