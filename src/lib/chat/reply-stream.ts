/**
 * Streams one assistant reply to the browser as NDJSON frames.
 *
 * Frames, one JSON object per line:
 *   {"type":"text","text":"..."}        a piece of the reply, in generation order
 *   {"type":"done","tokensUsed":123}    the reply is complete; nothing follows
 *   {"type":"error","message":"..."}    the reply failed; nothing follows
 *
 * A stream that ends without `done` or `error` is an interrupted reply, and
 * the client treats it as a failure. The HTTP status is decided before the
 * first frame, so pre-stream failures (quota, upstream 4xx/5xx) still arrive as
 * normal JSON error responses.
 *
 * The pump keeps running when the browser disconnects. The chat audit row is
 * written from `reply`, so an answer the model already produced is still
 * recorded, as it was when the whole reply was returned in one response.
 */

export const REPLY_FAILED_MESSAGE = "The assistant could not finish this reply. Please try again.";

export type ReplyFrame =
  | { type: "text"; text: string }
  | { type: "done"; tokensUsed: number }
  | { type: "error"; message: string };

export type CompletedReply = { text: string; tokensUsed: number };

/** The slice of a Gemini `GenerateContentStreamResult` the pump needs. */
export interface ReplySource {
  stream: AsyncIterable<{ text(): string }>;
  response: Promise<{ text(): string; usageMetadata?: { totalTokenCount?: number } | null }>;
}

export function streamModelReply(source: ReplySource): {
  body: ReadableStream<Uint8Array>;
  reply: Promise<CompletedReply | null>;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let open = true;

  const send = (frame: ReplyFrame) => {
    if (!open || !controller) return;
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
    } catch {
      // The browser went away; keep generating so the reply is still recorded.
      open = false;
    }
  };

  const close = () => {
    if (!open) return;
    open = false;
    try {
      controller?.close();
    } catch {
      // Already closed by cancel().
    }
  };

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      open = false;
    },
  });

  const reply = (async (): Promise<CompletedReply | null> => {
    // The SDK tees its stream, so a mid-stream failure rejects this promise as well.
    // It is only awaited on success, so mark it handled here; the await below still throws.
    source.response.catch(() => undefined);
    try {
      for await (const chunk of source.stream) {
        const piece = chunk.text();
        if (piece) send({ type: "text", text: piece });
      }
      const complete = await source.response;
      const result = { text: complete.text(), tokensUsed: complete.usageMetadata?.totalTokenCount || 0 };
      send({ type: "done", tokensUsed: result.tokensUsed });
      return result;
    } catch (err) {
      console.error("Chat reply stream failed:", err);
      send({ type: "error", message: REPLY_FAILED_MESSAGE });
      return null;
    } finally {
      close();
    }
  })();

  return { body, reply };
}
