import React from "react";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import ReceptionKanban from "@/components/ReceptionKanban";
import DataLoadError from "@/components/DataLoadError";
import { classifyRead } from "@/lib/read-outcome";
import { Document } from "@/types";

export const dynamic = "force-dynamic";

/**
 * Row caps for the reception board.
 *
 * The board used to select the entire `documents` table with no limit, which
 * measured 3.1 MB of HTML for 557 rows -- 21x the next largest authenticated
 * page, and 21x larger again by the time PostgREST's `db-max-rows` default of
 * 1000 was reached. Reception is the throughput-critical surface, so this is the
 * page that can least afford an unbounded first paint.
 *
 * Documents are not uniform, and the two groups want opposite treatment:
 *
 *  - `pending` is outstanding work. Reception triages from it, so it is the
 *    group that must not silently lose rows. It gets the large cap, and it is
 *    loaded newest-first so that if the cap is ever reached the rows that
 *    survive are the ones being worked today.
 *  - `approved` and `rejected` are terminal. Nothing further is done with them
 *    on this board, and they are the large majority of the table. They get a
 *    small cap, most recent first.
 *
 * These are caps, not a claim of completeness. Every cap that bites is
 * reported to reception with the true totals, because a board that silently
 * omits a referral is how a referral never gets actioned.
 */
const ACTIONABLE_LIMIT = 250;
const COMPLETED_LIMIT = 60;

const DOCUMENT_SELECT = `
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
`;

export default async function ReceptionQueuePage() {
  // 1. Authenticate user and enforce roles (Rule 1 & Rule 2)
  await requirePermission("documents.manage");
  const supabase = createClient();

  // 2. Fetch the board as two bounded reads, plus the true totals for each so
  //    the client can disclose anything the caps left out.
  const [actionableResult, completedResult, actionableTotalResult, completedTotalResult] =
    await Promise.all([
      supabase
        .from("documents")
        .select(DOCUMENT_SELECT)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(ACTIONABLE_LIMIT),

      supabase
        .from("documents")
        .select(DOCUMENT_SELECT)
        .in("status", ["approved", "rejected"])
        .order("created_at", { ascending: false })
        .limit(COMPLETED_LIMIT),

      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),

      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .in("status", ["approved", "rejected"]),
    ]);

  // A failed fetch must never reach the kanban as an empty board. Reception
  // reading five empty columns would conclude there are no pending referrals
  // and triage nothing while every uploaded document sits unseen.
  //
  // The data reads and the count reads are classified separately: a board with
  // no rows and a board whose *size* could not be measured are different
  // problems, and the second one is how a truncated board gets presented as a
  // complete one.
  const actionableRead = classifyRead(actionableResult);
  const completedRead = classifyRead(completedResult);
  const actionableTotalRead = classifyRead({
    data: actionableTotalResult.count,
    error: actionableTotalResult.error,
  });
  const completedTotalRead = classifyRead({
    data: completedTotalResult.count,
    error: completedTotalResult.error,
  });

  const loadError =
    (actionableRead.kind === "failed" ? actionableRead.error : null) ??
    (completedRead.kind === "failed" ? completedRead.error : null);

  // A count that failed leaves the total unknown rather than zero. Reporting 0
  // here would make the disclosure below claim nothing was omitted, which is the
  // one thing it must never do.
  const actionableTotal =
    actionableTotalRead.kind === "ok" ? actionableTotalRead.data : null;
  const completedTotal =
    completedTotalRead.kind === "ok" ? completedTotalRead.data : null;

  if (loadError) {
    console.error("Error fetching initial queue documents:", loadError);
  }

  const documents = [
    ...(actionableRead.kind === "ok" ? actionableRead.data ?? [] : []),
    ...(completedRead.kind === "ok" ? completedRead.data ?? [] : []),
  ] as Document[];

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

      {loadError ? (
        <DataLoadError
          what="the reception queue"
          error={loadError}
          retryHref="/reception/queue"
        />
      ) : (
        <>
          {/* Kanban Board Container */}
          <ReceptionKanban
            initialDocuments={documents}
            actionableTotal={actionableTotal}
            completedTotal={completedTotal}
          />
        </>
      )}
    </div>
  );
}