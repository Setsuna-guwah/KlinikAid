import type { ReplyFrame } from "@/lib/chat/reply-stream";

/** Shown when the reply stream ends, or is malformed, before its `done` frame. */
export const REPLY_INTERRUPTED_MESSAGE = "The assistant's reply was interrupted. Please try again.";

/**
 * Reads the NDJSON reply from `/api/chat`, passing each text piece to `onText`
 * as it arrives. Resolves only on the server's `done` frame. It throws on an
 * `error` frame, on a malformed frame, or when the stream closes first, so a
 * failed reply is never shown as a finished one.
 */
export async function readReplyStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let completed = false;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let frame: ReplyFrame;
    try {
      frame = JSON.parse(line) as ReplyFrame;
    } catch {
      throw new Error(REPLY_INTERRUPTED_MESSAGE);
    }
    if (frame.type === "text") {
      onText(frame.text);
    } else if (frame.type === "error") {
      throw new Error(frame.message);
    } else {
      completed = true;
    }
  };

  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      buffered += decoder.decode(chunk.value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        handle(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
      chunk = await reader.read();
    }
    buffered += decoder.decode();
    handle(buffered);

    if (!completed) {
      throw new Error(REPLY_INTERRUPTED_MESSAGE);
    }
  } finally {
    // Leaves the body unread only when we exit early (an error frame or a malformed
    // line). The server keeps generating on its own side regardless.
    await reader.cancel().catch(() => {});
  }
}
