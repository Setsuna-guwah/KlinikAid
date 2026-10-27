/**
 * Reassembling a knowledge document from the chunks the indexer stored.
 *
 * ## Why this is a module of its own
 *
 * `rag_documents` holds one row per *chunk*, not one row per document. The
 * uploader splits a document with `chunkText()` and writes every chunk as its
 * own row, all of them carrying the same `metadata.document_id`, its own
 * `metadata.chunk_index` and the same `metadata.total_chunks`. A document's
 * text therefore exists only as an ordered list of rows, and "the document's
 * text" is that list read in chunk order.
 *
 * The order is the whole point. Retrieval matches a question against a single
 * chunk, so a document read in the wrong order is a document nobody can
 * follow, and a document whose chunks are silently dropped is a document that
 * reads shorter than it is. Neither mistake is visible in the list view, which
 * only counts chunks.
 *
 * Kept free of Supabase and React so the rules can be unit-tested.
 */

/** The metadata the indexer writes on every chunk row. */
export interface RagChunkMetadata {
  document_id?: string;
  chunk_index?: number;
  total_chunks?: number;
  source_type?: string;
}

/** One row of `rag_documents`: a single chunk of a document. */
export interface RagChunkRow {
  id: string;
  title: string;
  content: string;
  metadata: RagChunkMetadata | null;
  created_at: string;
}

export type RagSourceType = "text" | "pdf";

/** One chunk of a document, in the order the retriever sees it. */
export interface RagDocumentChunk {
  /** 1-based position of this chunk in the document's chunk order. */
  position: number;
  /** The chunk's text, exactly as stored. */
  content: string;
  /** Length of `content` in characters. */
  characters: number;
}

/** A knowledge document, reassembled from its chunks. */
export interface RagDocumentContent {
  documentId: string;
  title: string;
  sourceType: RagSourceType;
  /** How many chunks are actually stored for this document. */
  chunkCount: number;
  /** Characters across the stored chunks, matching the list view's count. */
  characterCount: number;
  /** `total_chunks` as the indexer recorded it, when it recorded one. */
  declaredChunkCount: number | null;
  /** When the document was indexed: the earliest chunk's creation time. */
  indexedAt: string | null;
  chunks: RagDocumentChunk[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when the value can be a document id.
 *
 * Document ids reach the server from the URL, and they are interpolated into a
 * PostgREST filter. A shape check is what keeps that filter a filter: without
 * it, a crafted id could change what the filter means, and a mistyped one
 * would come back as a database error instead of a bad request.
 */
export function isRagDocumentId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** The chunk index the row recorded, or null when it recorded none. */
function storedChunkIndex(row: RagChunkRow): number | null {
  const index = row.metadata?.chunk_index;
  return typeof index === "number" && Number.isFinite(index) ? index : null;
}

/** `total_chunks` the row recorded, or null when it recorded none. */
function declaredChunkCount(row: RagChunkRow): number | null {
  const total = row.metadata?.total_chunks;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

/**
 * Total order over chunk rows.
 *
 * The recorded `chunk_index` decides the order, because that is the order the
 * indexer built the document in. Rows that recorded none cannot claim a place
 * in it, so they follow the indexed rows, oldest first. The final tiebreak on
 * the row id makes the order total: two rows that agree on everything else
 * still come out in the same order on every read, whatever order the database
 * happened to return them in.
 */
function compareChunkRows(a: RagChunkRow, b: RagChunkRow): number {
  const aIndex = storedChunkIndex(a);
  const bIndex = storedChunkIndex(b);

  if (aIndex !== null && bIndex !== null && aIndex !== bIndex) {
    return aIndex - bIndex;
  }
  if (aIndex !== null && bIndex === null) return -1;
  if (aIndex === null && bIndex !== null) return 1;

  const aTime = Date.parse(a.created_at);
  const bTime = Date.parse(b.created_at);
  if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
    return aTime - bTime;
  }

  return a.id.localeCompare(b.id);
}

/** The earliest creation time among the rows, as stored. */
function earliestTimestamp(rows: RagChunkRow[]): string | null {
  let earliest: string | null = null;
  let earliestTime = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const time = Date.parse(row.created_at);
    if (Number.isNaN(time)) continue;
    if (time < earliestTime) {
      earliestTime = time;
      earliest = row.created_at;
    }
  }

  return earliest ?? rows[0]?.created_at ?? null;
}

/**
 * Reassemble a document from its chunk rows.
 *
 * Returns `null` when there are no rows: the document does not exist, which
 * is a different answer from "the document exists and its text is empty", and
 * the caller has to be able to tell them apart.
 */
export function assembleRagDocument(
  rows: RagChunkRow[],
  documentId: string
): RagDocumentContent | null {
  if (!rows.length) return null;

  const ordered = [...rows].sort(compareChunkRows);

  const chunks: RagDocumentChunk[] = ordered.map((row, index) => {
    const content = row.content ?? "";
    return {
      position: index + 1,
      content,
      characters: content.length,
    };
  });

  const first = ordered[0];
  const sourceType: RagSourceType =
    ordered.some((row) => row.metadata?.source_type === "pdf") ? "pdf" : "text";

  return {
    documentId,
    title: first.title || "Untitled",
    sourceType,
    chunkCount: chunks.length,
    characterCount: chunks.reduce((total, chunk) => total + chunk.characters, 0),
    declaredChunkCount: declaredChunkCount(first),
    indexedAt: earliestTimestamp(ordered),
    chunks,
  };
}

/** Largest document, in characters, whose text rides along with the list. */
export const PRELOAD_DOCUMENT_CHARACTERS = 50_000;
/** Most text, in characters, the list carries across all documents together. */
export const PRELOAD_TOTAL_CHARACTERS = 250_000;

/**
 * The documents whose indexed text is sent with the knowledge-base list, so the
 * viewer opens without a second request.
 *
 * The list already reads every chunk's text to count characters, so this adds
 * no database work; it only decides how much of that text is serialised to the
 * page. Small documents are included in full, and the caps keep the page
 * bounded when the knowledge base is large. Anything left out is fetched when
 * the viewer is opened.
 *
 * Nothing is included when the list's own read may be incomplete: a read that
 * hit the row limit cannot be trusted to hold every chunk of a document, so
 * such a document would read as complete when it is not.
 */
export function preloadRagDocuments(
  rowsByDocument: ReadonlyMap<string, RagChunkRow[]>,
  { complete }: { complete: boolean }
): Map<string, RagDocumentContent> {
  const preloaded = new Map<string, RagDocumentContent>();
  if (!complete) return preloaded;

  let remaining = PRELOAD_TOTAL_CHARACTERS;
  for (const [documentId, rows] of rowsByDocument) {
    const characters = rows.reduce((total, row) => total + (row.content?.length ?? 0), 0);
    if (characters > PRELOAD_DOCUMENT_CHARACTERS || characters > remaining) continue;

    const document = assembleRagDocument(rows, documentId);
    if (!document) continue;

    remaining -= characters;
    preloaded.set(documentId, document);
  }
  return preloaded;
}
