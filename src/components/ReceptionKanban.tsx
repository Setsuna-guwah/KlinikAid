"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { Document } from "@/types";
import type { DetectedClinicTest } from "@/lib/documents/detectRequestedTests";
import {
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Database,
  Search,
  ChevronRight,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { fetchJson, type ApiError } from "@/lib/fetch-json";
import { documentMatchesSearch } from "@/lib/reception-search";
import DataLoadError from "@/components/DataLoadError";
import { focusRingClass, focusRingInsetClass } from "@/lib/focus-ring";

interface ReceptionKanbanProps {
  initialDocuments: Document[];
  /**
   * True totals from the server, or null when the count could not be read.
   *
   * These exist so the board can admit what it is not showing. `null` is
   * meaningful and must not be collapsed to 0: "0 documents omitted" is a claim
   * the board cannot support if the count failed, and it is the one claim that
   * would make a truncated board look complete.
   */
  actionableTotal: number | null;
  completedTotal: number | null;
}

/**
 * One column per value of the `documents.status` column (`DocumentStatus`), so
 * every column is one that a document can actually be in (issue #200).
 */
type ColumnId = "pending" | "approved" | "rejected";

interface Column {
  id: ColumnId;
  title: string;
  /** Shorter label for the mobile tab bar. */
  shortTitle: string;
  description: string;
  /** Colour of the thin bar on top of the column. */
  bar: string;
  icon: React.ReactNode;
  completed: boolean;
}

/** Cards rendered per column before "Load more". Every document stays in state and reachable. */
const PAGE_SIZE = 20;

/**
 * The four things a search can be. There is no member that means "searched and
 * found nothing" and no member that means "the search failed": those are two
 * different claims, and the board renders them as two different states.
 */
type SearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ok"; readonly documents: Document[]; readonly truncated: boolean }
  | { readonly kind: "failed"; readonly error: ApiError };

/** Delay before a server search is sent, to avoid a request per keystroke. */
const SEARCH_DEBOUNCE_MS = 250;

export default function ReceptionKanban({
  initialDocuments,
  actionableTotal,
  completedTotal,
}: ReceptionKanbanProps) {
  const supabase = createClient();
  const [documents, setDocuments] = useState<Document[]>(initialDocuments);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ kind: "idle" });
  // Each search fetch takes a ticket; only the newest may write the result.
  // Without this, a slow response to an older query can overwrite the answer
  // for the query the user is actually looking at (the LogsDashboardClient
  // pattern).
  const searchSeq = useRef(0);
  // Bumped by every realtime event so an active search is re-run: a change can
  // move a document into or out of the current matches, not just edit a card.
  const [searchRefresh, setSearchRefresh] = useState(0);
  const lastSearchedQuery = useRef("");
  // True while the loaded list is provably the whole table: both server counts
  // matched what the page loaded. Then a search can run here, with no request.
  // A realtime event can change the table behind the counts, so it clears this
  // for the rest of the page's life and searches go to the server again.
  const [boardExact, setBoardExact] = useState(
    () =>
      actionableTotal !== null &&
      completedTotal !== null &&
      actionableTotal === initialDocuments.filter((doc) => doc.status === "pending").length &&
      completedTotal === initialDocuments.filter((doc) => doc.status !== "pending").length,
  );
  const [showCompleted, setShowCompleted] = useState(false);
  const [visible, setVisible] = useState<Record<ColumnId, number>>({
    pending: PAGE_SIZE,
    approved: PAGE_SIZE,
    rejected: PAGE_SIZE,
  });
  const [activeTab, setActiveTab] = useState<ColumnId>("pending");

  // Bucket by the document's `status` column. The board used to read an
  // `extracted_metadata.ocr_confidence_score` that nothing in the codebase has
  // ever written, which left "AI Verified" and "Staff Review" structurally
  // unreachable (issue #200). Anything not yet approved or rejected is
  // actionable, so it lands in "pending" rather than disappearing.
  const getColumn = (doc: Document): ColumnId => {
    if (doc.status === "approved") return "approved";
    if (doc.status === "rejected") return "rejected";
    return "pending";
  };

  // Realtime Supabase Subscription
  useEffect(() => {
    const channel = supabase
      .channel("reception-documents-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
        },
        async (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          setSearchRefresh((n) => n + 1);
          setBoardExact(false);

          if (eventType === "DELETE") {
            setDocuments((prev) => prev.filter((doc) => doc.id !== oldRecord.id));
            toast.info("A document was deleted.");
            return;
          }

          // For INSERT or UPDATE, we need to fetch the fully-joined record (patient + uploader)
          // because Realtime payloads only contain the raw table row.
          const { data: fullyJoinedDoc, error } = await supabase
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
            .eq("id", newRecord.id)
            .single();

          if (error) {
            console.error("Error fetching realtime document details:", error);
            return;
          }

          if (fullyJoinedDoc) {
            setDocuments((prev) => {
              const exists = prev.some((d) => d.id === fullyJoinedDoc.id);
              if (exists) {
                // Update
                return prev.map((d) => (d.id === fullyJoinedDoc.id ? fullyJoinedDoc : d));
              } else {
                // Insert at the beginning of the list
                return [fullyJoinedDoc, ...prev];
              }
            });

            if (eventType === "INSERT") {
              toast.success(`New document uploaded: ${fullyJoinedDoc.file_name}`);
            } else if (eventType === "UPDATE") {
              toast.info(`Document status updated to: ${fullyJoinedDoc.status}`);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // The trimmed query decides whether the board searches the whole table on the
  // server or shows the local (capped) list. `searching` is true exactly when
  // there is something to search for.
  const trimmedQuery = searchQuery.trim();
  const searching = trimmedQuery.length > 0;

  // Server search, for a board that is not the whole table. Only the empty query
  // keeps the local list. A non-empty query on a complete board is answered from
  // the loaded documents instead (see `localSearch`), so no request is made. On a
  // truncated board the query must reach the server: the local list is capped
  // (#34) and would read "no match" for rows that were never loaded.
  //
  // Debounced, and each new query aborts the one before it. The sequence ticket
  // still guards the write, so only the newest query can set the result.
  useEffect(() => {
    const q = searchQuery.trim();
    // A realtime refresh of the same query keeps the current results on screen
    // until the new ones arrive; a new query shows the loading state.
    const isRefresh = q === lastSearchedQuery.current;
    lastSearchedQuery.current = q;
    if (q.length === 0 || boardExact) {
      setSearchState({ kind: "idle" });
      return;
    }

    const ticket = ++searchSeq.current;
    if (!isRefresh) setSearchState({ kind: "loading" });

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const outcome = await fetchJson<{ documents: Document[]; truncated: boolean }>(
        `/api/reception/documents/search?q=${encodeURIComponent(q)}`,
        { signal: controller.signal }
      );

      // A response to an older query does not describe the query on screen.
      if (controller.signal.aborted || ticket !== searchSeq.current) return;

      if (outcome.kind === "failed") {
        setSearchState({ kind: "failed", error: outcome.error });
        return;
      }

      setSearchState({
        kind: "ok",
        documents: outcome.data.documents,
        truncated: outcome.data.truncated,
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, searchRefresh, boardExact]);

  // A complete board is searched in place: the loaded documents are the whole
  // table, so the local match is the complete answer, with nothing truncated.
  const localSearch: SearchState | null =
    searching && boardExact
      ? {
          kind: "ok",
          documents: documents.filter((doc) => documentMatchesSearch(doc, trimmedQuery)),
          truncated: false,
        }
      : null;
  const search: SearchState = localSearch ?? searchState;

  // What the board renders: the server's full-table matches while a search is
  // active, otherwise the local list kept fresh by the realtime subscription.
  const displayDocuments = searching
    ? search.kind === "ok"
      ? search.documents
      : []
    : documents;

  // Group documents by column
  const columnsData: Record<ColumnId, Document[]> = {
    pending: [],
    approved: [],
    rejected: [],
  };

  displayDocuments.forEach((doc) => {
    const colId = getColumn(doc);
    columnsData[colId].push(doc);
  });

  // What this board is not showing.
  //
  // The server loads `pending` and terminal documents under separate caps, so
  // "how many rows are on screen" is no longer the same question as "how many
  // documents exist". Both are reported, and the difference is stated rather
  // than absorbed.
  //
  // `null` means the true total could not be measured. It is deliberately not
  // treated as 0, because 0 omitted is a completeness claim this board cannot
  // make when the count failed -- the same reason `classifyRead` refuses to
  // report an unreadable count as zero.
  const loadedActionable = documents.filter((doc) => doc.status === "pending").length;
  const loadedCompleted = documents.length - loadedActionable;

  const actionableOmitted =
    actionableTotal === null ? null : Math.max(0, actionableTotal - loadedActionable);
  const completedOmitted =
    completedTotal === null ? null : Math.max(0, completedTotal - loadedCompleted);

  const totalsUnknown = actionableTotal === null || completedTotal === null;
  const anythingOmitted = (actionableOmitted ?? 0) > 0 || (completedOmitted ?? 0) > 0;

  const columns: Column[] = [
    {
      id: "pending",
      title: "Pending",
      shortTitle: "Pending",
      description: "Uploaded by patients, awaiting reception review",
      bar: "bg-slate-400 dark:bg-slate-500",
      icon: <Database className="h-4 w-4 text-slate-500 dark:text-slate-400" />,
      completed: false,
    },
    {
      id: "approved",
      title: "Approved",
      shortTitle: "Approved",
      description: "Validated and patient successfully routed to triage queue",
      bar: "bg-primary",
      icon: <CheckCircle2 className="h-4 w-4 text-primary" />,
      completed: true,
    },
    {
      id: "rejected",
      title: "Rejected",
      shortTitle: "Rejected",
      description: "Returned to patient due to legibility or mismatch issues",
      bar: "bg-rose-500 dark:bg-rose-600",
      icon: <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />,
      completed: true,
    },
  ];

  const loadMore = (id: ColumnId) =>
    setVisible((prev) => ({ ...prev, [id]: prev[id] + PAGE_SIZE }));

  // Horizontal scroll affordance: fade + button on whichever side has more columns.
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, showCompleted, documents.length, searchQuery]);
  const nudge = (dir: 1 | -1) =>
    scroller.current?.scrollBy({ left: dir * 320, behavior: "smooth" });

  const shortAge = (iso: string) =>
    formatDistanceToNowStrict(new Date(iso))
      .replace(/ seconds?/, " s")
      .replace(/ minutes?/, " min")
      .replace(/ hours?/, " h")
      .replace(/ days?/, " d")
      .replace(/ months?/, " mo")
      .replace(/ years?/, " y");

  const pill = (doc: Document) => {
    const base = "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4";
    if (doc.file_type === "template") {
      return <span className={cn(base, "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200")}>Structured form</span>;
    }
    return <span className={cn(base, "bg-slate-200/70 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200")}>Web upload</span>;
  };

  const renderCard = (doc: Document) => {
    const metadata = doc.extracted_metadata as { selected_tests?: DetectedClinicTest[] } | null;
    const tests = Array.isArray(metadata?.selected_tests) ? metadata.selected_tests : [];
    const shown = tests.slice(0, 2);
    const extra = tests.length - shown.length;
    const name = doc.patient ? `${doc.patient.first_name} ${doc.patient.last_name}`.trim() : "";
    return (
      <li key={doc.id}>
        {/* The card draws its focus indicator *inside* its own box
            (`focusRingInsetClass`): a card is flush with the top of the
            column's scrollport, and the browser scrolls a focused card into
            view flush with an edge, so an indicator drawn outside the card
            is cut off by the column's clip (issue #192). */}
        <Link
          href={`/reception/queue/${doc.id}`}
          className={cn(
            "group block rounded-md border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-slate-400",
            "dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700",
            focusRingInsetClass
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "min-w-0 truncate text-[13px] font-semibold",
                name ? "text-slate-900 dark:text-slate-100 group-hover:text-primary" : "font-medium text-slate-500 dark:text-slate-400"
              )}
              title={name || "Unknown patient"}
            >
              {name || "Unknown patient"}
            </span>
            {pill(doc)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
            <span className="min-w-0 flex-1 truncate" title={doc.file_name}>{doc.file_name}</span>
            <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400" title={`${formatDistanceToNowStrict(new Date(doc.created_at))} ago`}>
              {shortAge(doc.created_at)}
            </span>
          </div>
          {shown.length > 0 && (
            <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
              {shown.map((t) => (
                <span key={t.id} className="max-w-[120px] truncate rounded-full border border-slate-200 bg-slate-50 px-2 text-[11px] leading-5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" title={t.label}>
                  {t.label}
                </span>
              ))}
              {extra > 0 && (
                <span
                  className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 text-[11px] leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  title={tests.slice(2).map((t) => t.label).join(", ")}
                >
                  +{extra}
                </span>
              )}
            </div>
          )}
        </Link>
      </li>
    );
  };

  const renderList = (col: Column) => {
    const list = columnsData[col.id];
    const shownCount = Math.min(visible[col.id], list.length);
    const remaining = list.length - shownCount;
    return (
      <>
        {list.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {searching ? "No matches" : "No documents"}
          </p>
        ) : (
          <ul className="space-y-2">{list.slice(0, shownCount).map((doc) => renderCard(doc))}</ul>
        )}
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => loadMore(col.id)}
            className={`mt-2 w-full rounded-md border border-slate-300 bg-white py-2 text-xs font-medium text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600 ${focusRingClass}`}
          >
            Show {Math.min(PAGE_SIZE, remaining)} more
            <span className="ml-1 text-slate-500 dark:text-slate-400">({remaining} not yet shown)</span>
          </button>
        )}
      </>
    );
  };

  // The one-line summary beside the search box. When searching, "loaded" would
  // be the wrong noun: the server searched the whole table, not the capped page.
  const statusText = searching
    ? search.kind === "ok"
      ? `${search.documents.length} match${search.documents.length === 1 ? "" : "es"} across all records`
      : search.kind === "loading"
        ? "Searching all records…"
        : "Search unavailable"
    : `Showing ${documents.length} loaded`;

  // The board renders only when there is something to show. During a search
  // that is still loading, failed, or returned nothing, a dedicated status
  // replaces the empty columns so "no results" is never confused with a
  // search that has not run or a search that did not complete.
  const showBoard = !searching || (search.kind === "ok" && search.documents.length > 0);
  const showMoreResults = searching && search.kind === "ok" && search.truncated;

  const completedCount = columnsData.approved.length + columnsData.rejected.length;
  // During a search the completed columns are always shown: the search spans the
  // whole table including approved/rejected history, so a match there must not
  // be hidden behind the "Recently completed" toggle.
  const desktopColumns = columns.filter((c) => !c.completed || showCompleted || searching);
  const activeCol = columns.find((c) => c.id === activeTab) ?? columns[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Search */}
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400 dark:text-slate-500" />
          <Input
            placeholder="Search patient, file name, type…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 bg-white dark:bg-slate-800 pl-9 text-sm"
            aria-label="Search the queue"
          />
        </div>
        <div className="flex items-center gap-3 sm:ml-auto">
          <span className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-400 tabular-nums">
            {statusText}
          </span>
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            aria-expanded={showCompleted}
            className={`hidden items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600 md:inline-flex ${focusRingClass}`}
          >
            {showCompleted ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Recently completed
            <span className="rounded-full bg-slate-100 px-1.5 text-[11px] tabular-nums text-slate-700 dark:bg-slate-700 dark:text-slate-200">{completedCount}</span>
          </button>
        </div>
      </div>

      {/* Truncation disclosure. The board loads under server-side caps, so the row count
          on screen is not the number of documents that exist. That gap is stated here
          rather than left for reception to infer: a board that looks complete while
          omitting referrals is how a referral is never actioned. Collapsed to one line;
          the full statement is one click away. */}
      {!searching && (anythingOmitted ? (
        <details role="status" className="group shrink-0 rounded-md border border-amber-200 bg-amber-50 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <summary className={`flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium ${focusRingClass}`}>
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              Capped view:{" "}
              {[
                actionableOmitted ? `${actionableOmitted} awaiting-action not listed` : null,
                completedOmitted ? `${completedOmitted} completed not listed` : null,
              ].filter(Boolean).join(", ")}
            </span>
            <span className="shrink-0 underline underline-offset-2 group-open:hidden">Details</span>
          </summary>
          <div className="space-y-1 px-3 pb-3 pl-9">
            <ul className="list-disc space-y-0.5 pl-4">
              {actionableOmitted ? (
                <li>
                  {actionableOmitted} awaiting-action{" "}
                  {actionableOmitted === 1 ? "document is" : "documents are"} not
                  listed. Anything not shown here is older than what is. Search
                  reaches all records, so use it to find them.
                </li>
              ) : null}
              {completedOmitted ? (
                <li>
                  {completedOmitted} completed{" "}
                  {completedOmitted === 1 ? "document is" : "documents are"} not
                  listed. Only the most recent approved and rejected documents are
                  loaded. Search reaches the rest of the history.
                </li>
              ) : null}
            </ul>
            <p className="text-amber-800 dark:text-amber-200">
              Every pending document{" "}
              {actionableOmitted ? "up to the cap" : "currently"} is loaded, so
              nothing awaiting triage has been dropped from the top of the queue.
            </p>
          </div>
        </details>
      ) : totalsUnknown ? (
        <div role="status" className="flex shrink-0 items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            The total document count could not be read, so this board cannot
            confirm how much it is leaving out. Treat the columns as a partial
            view until the page reloads successfully.
          </p>
        </div>
      ) : null)}

      {/* Search status. Distinct from "no search run" and from an empty result:
          a search that failed must not render as "no matches", and the definitive
          "nothing matches" is stated only for a search the server reported as
          complete — a truncated search that lists nothing has not proven the
          absence of matches, so it falls through to the truncation notice. */}
      {searching && search.kind === "loading" && (
        <div role="status" aria-live="polite" className="flex shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400 dark:text-slate-500" />
          <p>Searching all records…</p>
        </div>
      )}
      {searching && search.kind === "failed" && (
        <DataLoadError what="the document search" error={search.error} />
      )}
      {searching && search.kind === "ok" && search.documents.length === 0 && !search.truncated && (
        <div role="status" aria-live="polite" className="flex shrink-0 items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <Search className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
          <p>
            No documents match <span className="font-medium">“{trimmedQuery}”</span> across all records.
          </p>
        </div>
      )}
      {showMoreResults && (
        <div role="status" className="flex shrink-0 items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            There are more matches for <span className="font-medium">“{trimmedQuery}”</span> than can be shown.
            Refine your search to see the rest.
          </p>
        </div>
      )}

      {/* Mobile: one status at a time */}
      {showBoard && (
        <>
          <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <div role="tablist" aria-label="Queue status" className="-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 pb-2">
          {columns.map((col) => {
            const selected = col.id === activeCol.id;
            return (
              <button
                key={col.id}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setActiveTab(col.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium",
                  focusRingClass,
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                )}
              >
                {col.shortTitle}
                <span className={cn("tabular-nums", selected ? "text-primary-foreground/85" : "text-slate-500 dark:text-slate-400")}>{columnsData[col.id].length}</span>
              </button>
            );
          })}
        </div>
        <section role="tabpanel" aria-label={activeCol.title} className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-slate-900/[0.035] dark:bg-white/[0.04] p-2">
          <p className="px-1 pb-2 text-xs text-slate-600 dark:text-slate-400">{activeCol.description}</p>
          {renderList(activeCol)}
        </section>
      </div>

      {/* Desktop board: fixed-width columns in a snapping horizontal scroller */}
      <div className="relative hidden min-h-0 flex-1 md:block">
        {/* The board is a scroll region and a focus stop of its own
            (`tabIndex={0}`), and it carries `outline-none`, so the app-wide
            scroll-region rule in `src/app/globals.css` does not apply to it.
            It draws its indicator inside its own box for the same reason the
            cards do (issue #192). */}
        <div
          ref={scroller}
          onScroll={measure}
          tabIndex={0}
          aria-label="Queue board, scroll horizontally for more columns"
          className={`flex h-full snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden scroll-smooth pb-2 ${focusRingInsetClass}`}
        >
          {desktopColumns.map((col) => {
            const list = columnsData[col.id];
            if (list.length === 0) {
              return (
                <div
                  key={col.id}
                  className="relative flex w-12 shrink-0 snap-start flex-col items-center overflow-hidden rounded-lg bg-slate-900/[0.035] dark:bg-white/[0.04] py-3"
                  title={`${col.title}: ${searching ? "no matches" : "no documents"}. ${col.description}`}
                >
                  <span className={cn("absolute inset-x-0 top-0 h-[3px]", col.bar)} />
                  <span className="mt-1">{col.icon}</span>
                  <span className="mt-2 text-xs tabular-nums text-slate-600 dark:text-slate-400">0</span>
                  <span className="mt-3 text-xs font-medium text-slate-600 dark:text-slate-400 [text-orientation:mixed] [writing-mode:vertical-rl]">{col.title}</span>
                </div>
              );
            }
            return (
              <section
                key={col.id}
                aria-label={`${col.title}, ${list.length} documents`}
                className="relative flex w-[300px] shrink-0 snap-start flex-col overflow-hidden rounded-lg bg-slate-900/[0.035] dark:bg-white/[0.04]"
              >
                <span className={cn("absolute inset-x-0 top-0 h-[3px]", col.bar)} />
                <header className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3.5" title={col.description}>
                  {col.icon}
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{col.title}</h2>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">
                    {list.length}
                  </span>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{renderList(col)}</div>
              </section>
            );
          })}
        </div>
        {edges.left && (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />
            <button type="button" onClick={() => nudge(-1)} aria-label="Scroll board left" className={`absolute left-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 ${focusRingClass}`}>
              <ChevronRight className="h-4 w-4 rotate-180" />
            </button>
          </>
        )}
        {edges.right && (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
            <button type="button" onClick={() => nudge(1)} aria-label="Scroll board right" className={`absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 ${focusRingClass}`}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
        </>
      )}
    </div>
  );
}
