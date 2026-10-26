import { describe, expect, it } from "vitest";
import { REPLY_FAILED_MESSAGE, streamModelReply, type ReplySource } from "@/lib/chat/reply-stream";
import { readReplyStream, REPLY_INTERRUPTED_MESSAGE } from "@/lib/chat/read-reply-stream";

const piece = (text: string) => ({ text: () => text });

/** A source that yields `pieces`, then either completes or fails with `failure`. */
function sourceOf(pieces: string[], options: { failAfter?: Error; tokens?: number } = {}): ReplySource {
  async function* stream() {
    for (const text of pieces) {
      yield piece(text);
      await Promise.resolve();
    }
    if (options.failAfter) throw options.failAfter;
  }
  const full = pieces.join("");
  return {
    stream: stream(),
    // A failing stream never reaches its final response, so that promise stays pending.
    response: options.failAfter
      ? new Promise<never>(() => {})
      : Promise.resolve({ text: () => full, usageMetadata: { totalTokenCount: options.tokens ?? 42 } }),
  };
}

async function collect(body: ReadableStream<Uint8Array>) {
  const text = await new Response(body).text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; text?: string; tokensUsed?: number; message?: string });
}

describe("streamModelReply", () => {
  it("sends each piece as a text frame, then done with the token count", async () => {
    const { body, reply } = streamModelReply(sourceOf(["Clinic ", "opens at 7."], { tokens: 9 }));

    const frames = await collect(body);

    expect(frames).toEqual([
      { type: "text", text: "Clinic " },
      { type: "text", text: "opens at 7." },
      { type: "done", tokensUsed: 9 },
    ]);
    await expect(reply).resolves.toEqual({ text: "Clinic opens at 7.", tokensUsed: 9 });
  });

  it("sends an error frame and resolves to null when the model fails before any text", async () => {
    const { body, reply } = streamModelReply(sourceOf([], { failAfter: new Error("upstream 500") }));

    const frames = await collect(body);

    expect(frames).toEqual([{ type: "error", message: REPLY_FAILED_MESSAGE }]);
    await expect(reply).resolves.toBeNull();
  });

  it("keeps the partial text ahead of the error frame, and never sends done", async () => {
    const { body, reply } = streamModelReply(
      sourceOf(["Fasting is", " usually"], { failAfter: new Error("connection reset") }),
    );

    const frames = await collect(body);

    expect(frames.map((frame) => frame.type)).toEqual(["text", "text", "error"]);
    expect(frames.some((frame) => frame.type === "done")).toBe(false);
    await expect(reply).resolves.toBeNull();
  });

  it("skips empty pieces so no empty text frame reaches the browser", async () => {
    const { body } = streamModelReply(sourceOf(["", "Hi", ""]));

    const frames = await collect(body);

    expect(frames.filter((frame) => frame.type === "text")).toEqual([{ type: "text", text: "Hi" }]);
  });

  it("keeps generating after the browser disconnects, so the completed reply is still returned", async () => {
    const { body, reply } = streamModelReply(sourceOf(["Fast ", "for 10 hours."], { tokens: 7 }));
    await body.cancel();

    await expect(reply).resolves.toEqual({ text: "Fast for 10 hours.", tokensUsed: 7 });
  });
});

describe("readReplyStream", () => {
  function bodyOf(...chunks: string[]) {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
  }

  it("passes text pieces in order and resolves on done", async () => {
    const received: string[] = [];

    await readReplyStream(
      bodyOf('{"type":"text","text":"Hello "}\n{"type":"text","text":"there"}\n{"type":"done","tokensUsed":3}\n'),
      (text) => received.push(text),
    );

    expect(received).toEqual(["Hello ", "there"]);
  });

  it("reassembles frames that arrive split across chunks", async () => {
    const received: string[] = [];

    await readReplyStream(
      bodyOf('{"type":"te', 'xt","text":"Split"}\n{"type":"do', 'ne","tokensUsed":1}\n'),
      (text) => received.push(text),
    );

    expect(received).toEqual(["Split"]);
  });

  it("throws the server's message for an error frame instead of resolving", async () => {
    await expect(
      readReplyStream(bodyOf('{"type":"text","text":"Partial"}\n{"type":"error","message":"model failed"}\n'), () => {}),
    ).rejects.toThrow("model failed");
  });

  it("treats a stream that closes before done as an interrupted reply", async () => {
    await expect(readReplyStream(bodyOf('{"type":"text","text":"Half"}\n'), () => {})).rejects.toThrow(
      REPLY_INTERRUPTED_MESSAGE,
    );
  });

  it("treats a malformed frame as an interrupted reply", async () => {
    await expect(readReplyStream(bodyOf("not json\n"), () => {})).rejects.toThrow(REPLY_INTERRUPTED_MESSAGE);
  });

  it("does not resolve for an empty body", async () => {
    await expect(readReplyStream(bodyOf(), () => {})).rejects.toThrow(REPLY_INTERRUPTED_MESSAGE);
  });
});
