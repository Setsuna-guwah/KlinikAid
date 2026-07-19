import React from "react";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import ReceptionKanban from "@/components/ReceptionKanban";
import { Document } from "@/types";

export const dynamic = "force-dynamic";

export default async function ReceptionQueuePage() {
  // 1. Authenticate user and enforce roles (Rule 1 & Rule 2)
  await requirePermission("documents.manage");
  const supabase = createClient();

  // 2. Fetch initial documents with patient and uploader relationships
  const { data: rawDocs, error } = await supabase
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
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching initial queue documents:", error);
  }

  const documents = (rawDocs || []) as Document[];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Reception Queue & Documents
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Review, approve and triage patient documents, referrals, and lab requisitions
        </p>
      </div>

      {/* Kanban Board Container */}
      <ReceptionKanban initialDocuments={documents} />
    </div>
  );
}
