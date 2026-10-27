import { describe, expect, it } from "vitest";
import {
  PRELOAD_DOCUMENT_CHARACTERS,
  PRELOAD_TOTAL_CHARACTERS,
  assembleRagDocument,
  isRagDocumentId,
  preloadRagDocuments,
  type RagChunkRow,
} from "./document-content";

const DOCUMENT_ID = "6aee0a07-8a7a-493f-a6d1-75ecc87f64c0";

function chunk(
  id: string,
  content: string,
  options: {
    chunkIndex?: number | null;
    totalChunks?: number | null;
    sourceType?: string;
    title?: string;
    createdAt?: string;
  } = {}
): RagChunkRow {
  const {
    chunkIndex = 0,
    totalChunks = null,
    sourceType = "text",
    title = "Clinic Overview",
    createdAt = "2026-07-08T06:17:59.634679+00:00",
  } = options;

  return {
    id,
    title,
    content,
    created_at: createdAt,
    metadata:
      chunkIndex === null && totalChunks === null
        ? null
        : {
            document_id: DOCUMENT_ID,
            ...(chunkIndex === null ? {} : { chunk_index: chunkIndex }),
            ...(totalChunks === null ? {} : { total_chunks: totalChunks }),
            source_type: sourceType,
          },
  };
}

describe("assembleRagDocument", () => {
  it("returns null when the document has no rows", () => {
    // "does not exist" and "exists but is empty" are different answers.
    expect(assembleRagDocument([], DOCUMENT_ID)).toBeNull();
  });

  it("reads a single-chunk document", () => {
    const text = "Clinic hours are 8am to 5pm.";
    const document = assembleRagDocument(
      [chunk("row-1", text, { chunkIndex: 0, totalChunks: 1 })],
      DOCUMENT_ID
    );

    expect(document).not.toBeNull();
    expect(document?.chunkCount).toBe(1);
    expect(document?.characterCount).toBe(text.length);
    expect(document?.chunks).toHaveLength(1);
    expect(document?.chunks[0]).toMatchObject({ position: 1, content: "Clinic hours are 8am to 5pm." });
  });

  it("orders chunks by the index the indexer recorded, not by the order the rows arrive in", () => {
    const document = assembleRagDocument(
      [
        chunk("row-3", "third", { chunkIndex: 2, totalChunks: 3 }),
        chunk("row-1", "first", { chunkIndex: 0, totalChunks: 3 }),
        chunk("row-2", "second", { chunkIndex: 1, totalChunks: 3 }),
      ],
      DOCUMENT_ID
    );

    expect(document?.chunks.map((c) => c.content)).toEqual(["first", "second", "third"]);
    expect(document?.chunks.map((c) => c.position)).toEqual([1, 2, 3]);
  });

  it("numbers chunks from one so the view can say 'Chunk 2 of 3'", () => {
    const document = assembleRagDocument(
      [
        chunk("row-0", "a", { chunkIndex: 0, totalChunks: 3 }),
        chunk("row-1", "b", { chunkIndex: 1, totalChunks: 3 }),
        chunk("row-2", "c", { chunkIndex: 2, totalChunks: 3 }),
      ],
      DOCUMENT_ID
    );

    expect(document?.chunkCount).toBe(3);
    expect(document?.chunks[1].position).toBe(2);
  });

  it("puts rows that recorded no chunk index after the indexed rows, oldest first", () => {
    const document = assembleRagDocument(
      [
        chunk("row-legacy-new", "legacy new", {
          chunkIndex: null,
          createdAt: "2026-07-09T00:00:00+00:00",
        }),
        chunk("row-0", "indexed", { chunkIndex: 0, totalChunks: 1 }),
        chunk("row-legacy-old", "legacy old", {
          chunkIndex: null,
          createdAt: "2026-07-08T00:00:00+00:00",
        }),
      ],
      DOCUMENT_ID
    );

    expect(document?.chunks.map((c) => c.content)).toEqual([
      "indexed",
      "legacy old",
      "legacy new",
    ]);
  });

  it("breaks a tie on the recorded index by creation time and then by id", () => {
    const document = assembleRagDocument(
      [
        chunk("row-b", "second written", {
          chunkIndex: 0,
          createdAt: "2026-07-08T06:18:00+00:00",
        }),
        chunk("row-a", "first written", {
          chunkIndex: 0,
          createdAt: "2026-07-08T06:17:00+00:00",
        }),
      ],
      DOCUMENT_ID
    );

    expect(document?.chunks.map((c) => c.content)).toEqual(["first written", "second written"]);
  });

  it("counts the characters of every stored chunk", () => {
    const document = assembleRagDocument(
      [
        chunk("row-0", "12345", { chunkIndex: 0, totalChunks: 2 }),
        chunk("row-1", "678", { chunkIndex: 1, totalChunks: 2 }),
      ],
      DOCUMENT_ID
    );

    expect(document?.characterCount).toBe(8);
    expect(document?.chunks.map((c) => c.characters)).toEqual([5, 3]);
  });

  it("reports the source type and the chunk count the indexer recorded", () => {
    const pdf = assembleRagDocument(
      [chunk("row-0", "text", { chunkIndex: 0, totalChunks: 2, sourceType: "pdf" })],
      DOCUMENT_ID
    );
    const text = assembleRagDocument(
      [chunk("row-0", "text", { chunkIndex: 0, totalChunks: 1, sourceType: "text" })],
      DOCUMENT_ID
    );

    expect(pdf?.sourceType).toBe("pdf");
    expect(pdf?.declaredChunkCount).toBe(2);
    expect(text?.sourceType).toBe("text");
    expect(text?.declaredChunkCount).toBe(1);
  });

  it("dates the document by the earliest chunk it was stored with", () => {
    const document = assembleRagDocument(
      [
        chunk("row-1", "b", {
          chunkIndex: 1,
          totalChunks: 2,
          createdAt: "2026-07-08T06:20:00+00:00",
        }),
        chunk("row-0", "a", {
          chunkIndex: 0,
          totalChunks: 2,
          createdAt: "2026-07-08T06:17:59+00:00",
        }),
      ],
      DOCUMENT_ID
    );

    expect(document?.indexedAt).toBe("2026-07-08T06:17:59+00:00");
  });

  it("falls back to a placeholder title when the row has none", () => {
    const document = assembleRagDocument(
      [chunk("row-0", "text", { chunkIndex: 0, title: "" })],
      DOCUMENT_ID
    );

    expect(document?.title).toBe("Untitled");
  });

  it("leaves the document id it was asked for", () => {
    const document = assembleRagDocument(
      [chunk("row-0", "text", { chunkIndex: 0 })],
      DOCUMENT_ID
    );

    expect(document?.documentId).toBe(DOCUMENT_ID);
  });
});

describe("isRagDocumentId", () => {
  it("accepts a uuid", () => {
    expect(isRagDocumentId(DOCUMENT_ID)).toBe(true);
    expect(isRagDocumentId("6AEE0A07-8A7A-493F-A6D1-75ECC87F64C0")).toBe(true);
  });

  it.each(["", "not-a-uuid", "6aee0a07-8a7a-493f-a6d1", "'; drop table rag_documents; --", "../../etc/passwd"])(
    "rejects %s",
    (value) => {
      expect(isRagDocumentId(value)).toBe(false);
    }
  );

  it("rejects a value that is not a string", () => {
    expect(isRagDocumentId(undefined)).toBe(false);
    expect(isRagDocumentId(null)).toBe(false);
    expect(isRagDocumentId(42)).toBe(false);
  });
});

describe("preloadRagDocuments", () => {
  const OTHER_ID = "1f0c3c8e-7a52-4d6e-9b1a-2f3e4d5c6b7a";

  function grouped(entries: [string, RagChunkRow[]][]) {
    return new Map(entries);
  }

  it("includes a small document in full, with the same text the viewer would fetch", () => {
    const rows = [chunk(DOCUMENT_ID, "hello", { chunkIndex: 1 })];
    const preloaded = preloadRagDocuments(grouped([[DOCUMENT_ID, rows]]), { complete: true });

    expect(preloaded.get(DOCUMENT_ID)).toEqual(assembleRagDocument(rows, DOCUMENT_ID));
  });

  it("includes nothing when the list read may be incomplete, so a partial document never reads as whole", () => {
    const rows = [chunk(DOCUMENT_ID, "hello", { chunkIndex: 1 })];
    const preloaded = preloadRagDocuments(grouped([[DOCUMENT_ID, rows]]), { complete: false });

    expect(preloaded.size).toBe(0);
  });

  it("leaves out a document over the per-document cap, to be fetched on open", () => {
    const rows = [chunk(DOCUMENT_ID, "x".repeat(PRELOAD_DOCUMENT_CHARACTERS + 1), { chunkIndex: 1 })];
    const preloaded = preloadRagDocuments(grouped([[DOCUMENT_ID, rows]]), { complete: true });

    expect(preloaded.has(DOCUMENT_ID)).toBe(false);
  });

  it("skips a document that would overflow the page-wide cap, and keeps later ones that fit", () => {
    // Four full documents use 200,000 of the 250,000 characters: 50,000 remain.
    const entries: [string, RagChunkRow[]][] = [];
    for (let i = 1; i <= 4; i += 1) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      entries.push([id, [chunk(id, "f".repeat(PRELOAD_DOCUMENT_CHARACTERS), { chunkIndex: 1 })]]);
    }
    const fits = [chunk(DOCUMENT_ID, "a".repeat(30_000), { chunkIndex: 1 })];
    const overflows = [chunk(OTHER_ID, "b".repeat(30_000), { chunkIndex: 1 })];
    const smallLater = "00000000-0000-4000-8000-0000000000aa";
    entries.push([DOCUMENT_ID, fits], [OTHER_ID, overflows], [smallLater, [chunk(smallLater, "c".repeat(10_000), { chunkIndex: 1 })]]);

    const preloaded = preloadRagDocuments(grouped(entries), { complete: true });

    expect(preloaded.has(DOCUMENT_ID)).toBe(true);
    expect(preloaded.has(OTHER_ID)).toBe(false);
    expect(preloaded.has(smallLater)).toBe(true);
  });

  it("never ships more than the page-wide cap in total", () => {
    const docs: [string, RagChunkRow[]][] = [];
    for (let i = 0; i < 20; i += 1) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      docs.push([id, [chunk(id, "c".repeat(PRELOAD_DOCUMENT_CHARACTERS), { chunkIndex: 1 })]]);
    }
    const preloaded = preloadRagDocuments(grouped(docs), { complete: true });
    const total = [...preloaded.values()].reduce((sum, doc) => sum + doc.characterCount, 0);

    expect(total).toBeLessThanOrEqual(PRELOAD_TOTAL_CHARACTERS);
    expect(preloaded.size).toBe(Math.floor(PRELOAD_TOTAL_CHARACTERS / PRELOAD_DOCUMENT_CHARACTERS));
  });
});
