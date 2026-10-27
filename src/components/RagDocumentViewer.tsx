"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import DataLoadError from "@/components/DataLoadError";
import { fetchJson, type ApiError, type FetchOutcome } from "@/lib/fetch-json";
import { formatPhTimeFull } from "@/lib/utils";
import type { RagDocumentContent } from "@/lib/rag/document-content";
import { Eye, FileText, Loader2 } from "lucide-react";

interface RagDocumentViewerProps {
  documentId: string;
  title: string;
  /** The text, when the list already carried it. Opening then makes no request. */
  preloaded?: RagDocumentContent | null;
}

type DocumentOutcome = FetchOutcome<{ document: RagDocumentContent }>;

function requestDocument(documentId: string): Promise<DocumentOutcome> {
  return fetchJson<{ document: RagDocumentContent }>(
    `/api/admin/rag/documents/${encodeURIComponent(documentId)}`
  );
}

type ViewState =
  | { kind: "loading" }
  | { kind: "failed"; error: ApiError }
  | { kind: "loaded"; document: RagDocumentContent };

/**
 * The read-only view of one knowledge document's indexed text.
 *
 * The text is fetched on demand rather than with the list: a knowledge base of
 * real clinical guidelines is large, and the list only needs titles and
 * counts. A failed load is shown as a failure, never as an empty document --
 * "this document is empty" and "we could not read this document" are very
 * different claims, and only one of them is true.
 */
export default function RagDocumentViewer({
  documentId,
  title,
  preloaded = null,
}: RagDocumentViewerProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ViewState | null>(null);

  // Which load is the current one. The sheet stays mounted when it closes, so
  // a close and a reopen can have two loads in flight; without this the older
  // answer would be allowed to overwrite the newer one.
  const currentLoad = useRef(0);

  // A request started on pointer-down or focus, before the click that opens the
  // viewer. It is used once, by the next open; a failed one is dropped so that
  // open asks again rather than showing an old failure.
  const prefetched = useRef<Promise<DocumentOutcome> | null>(null);

  const prefetch = () => {
    if (preloaded || prefetched.current) return;
    const request = requestDocument(documentId);
    prefetched.current = request;
    void request.then((outcome) => {
      if (outcome.kind === "failed" && prefetched.current === request) prefetched.current = null;
    });
  };

  const load = useCallback(async () => {
    const loadId = ++currentLoad.current;
    setState({ kind: "loading" });

    const request = prefetched.current ?? requestDocument(documentId);
    prefetched.current = null;
    const outcome = await request;

    if (loadId !== currentLoad.current) return;

    if (outcome.kind === "failed") {
      setState({ kind: "failed", error: outcome.error });
      return;
    }

    setState({ kind: "loaded", document: outcome.data.document });
  }, [documentId]);

  const openViewer = () => {
    setOpen(true);
    if (preloaded) {
      // The text came with the list. Any load still running is now out of date.
      currentLoad.current += 1;
      setState({ kind: "loaded", document: preloaded });
      return;
    }
    void load();
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={openViewer}
        onPointerDown={prefetch}
        onFocus={prefetch}
        aria-label={`View the indexed text of ${title}`}
        className="text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className="gap-0 p-0 data-[side=right]:sm:max-w-2xl"
          data-testid="rag-document-viewer"
        >
          <SheetHeader className="border-b border-border p-4 pr-12">
            <SheetTitle className="flex items-start gap-2 break-words">
              <FileText
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              {title}
            </SheetTitle>
            <SheetDescription>
              The indexed text of this knowledge document, in the order the assistant
              retrieves it. Read-only.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4">
            {state === null || state.kind === "loading" ? (
              <p
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Loading the indexed text...
              </p>
            ) : state.kind === "failed" ? (
              <div className="space-y-3">
                <DataLoadError
                  what="the indexed text of this document"
                  error={state.error}
                  description="This document's text is unknown because the request failed, not because the document is empty. Nothing below this message can be trusted until it loads."
                />
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            ) : (
              <DocumentContent document={state.document} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function DocumentContent({ document }: { document: RagDocumentContent }) {
  // One chunk is the whole document: there is no boundary to mark.
  const showChunkBoundaries = document.chunkCount > 1;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Type</dt>
        <dd>
          <Badge variant="secondary">{document.sourceType.toUpperCase()}</Badge>
        </dd>

        <dt className="text-muted-foreground">Chunks</dt>
        <dd>{document.chunkCount}</dd>

        <dt className="text-muted-foreground">Characters</dt>
        <dd>{document.characterCount.toLocaleString()}</dd>

        <dt className="text-muted-foreground">Indexed</dt>
        <dd>{formatPhTimeFull(document.indexedAt)}</dd>

        <dt className="text-muted-foreground">Source file</dt>
        <dd className="break-words">
          {document.sourceType === "pdf"
            ? document.title
            : "Pasted plain text (no file)"}
        </dd>
      </dl>

      {document.declaredChunkCount !== null &&
        document.declaredChunkCount !== document.chunkCount && (
          <p className="text-xs text-muted-foreground">
            The index recorded {document.declaredChunkCount} chunks, but{" "}
            {document.chunkCount} are stored. The text below is everything that is
            stored.
          </p>
        )}

      {showChunkBoundaries && (
        <p className="text-xs text-muted-foreground">
          The chunks are shown exactly as they are stored. Consecutive chunks
          overlap, so text near a boundary can appear twice.
        </p>
      )}

      <div className="space-y-3">
        {document.chunks.map((chunk) => (
          <section
            key={chunk.position}
            aria-label={
              showChunkBoundaries
                ? `Chunk ${chunk.position} of ${document.chunkCount}`
                : undefined
            }
          >
            {showChunkBoundaries && (
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                Chunk {chunk.position} of {document.chunkCount}
              </h3>
            )}
            <div
              className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 text-sm leading-relaxed"
              data-testid="rag-document-chunk"
            >
              {chunk.content}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
