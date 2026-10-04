import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchJson } from "./fetch-json";

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("unwraps the data member of a success envelope", async () => {
    respondWith({ success: true, message: "ok", data: { logs: [1, 2] } });

    const outcome = await fetchJson<{ logs: number[] }>("/api/admin/logs/system");

    expect(outcome).toEqual({ kind: "ok", status: 200, data: { logs: [1, 2] } });
  });

  it("reports an unreachable server as failed rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const outcome = await fetchJson("/api/admin/logs/system");

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.status).toBe(0);
      expect(outcome.error).toBeInstanceOf(ApiError);
    }
  });

  it("treats a non-JSON response as failed", async () => {
    // An HTML 502 from a proxy is HTTP 502 and parses as JSON only if you are
    // careless. Reading it as an empty payload is how an audit trail "empties".
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }))
    );

    const outcome = await fetchJson("/api/admin/logs/system");

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.status).toBe(502);
      expect(outcome.error.message).toContain("not JSON");
    }
  });

  it("treats a non-2xx status as failed and keeps the server message", async () => {
    respondWith({ success: false, message: "Failed to fetch system logs." }, 500);

    const outcome = await fetchJson("/api/admin/logs/system");

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.status).toBe(500);
      expect(outcome.error.message).toBe("Failed to fetch system logs.");
    }
  });

  it("treats HTTP 200 carrying success:false as failed", async () => {
    // `res.ok` is true here. Checking `res.ok` alone is the bug this guards.
    respondWith({ success: false, message: "Could not read the audit trail." }, 200);

    const outcome = await fetchJson("/api/admin/logs/system");

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.error.message).toBe("Could not read the audit trail.");
    }
  });

  it("falls back to a status-derived message when the server sends none", async () => {
    respondWith({}, 503);

    const outcome = await fetchJson("/api/admin/logs/system");

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.error.message).toContain("503");
    }
  });

  it("preserves debug_details for logging without rendering it", async () => {
    respondWith(
      { success: false, message: "nope", debug_details: { code: "42501" } },
      500
    );

    const outcome = await fetchJson("/api/admin/logs/system");

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.error.detail).toEqual({ code: "42501" });
    }
  });

  it("passes through an unwrapped payload from a route with no envelope", async () => {
    respondWith([{ id: "a" }], 200);

    const outcome = await fetchJson<Array<{ id: string }>>("/api/thing");

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.data).toEqual([{ id: "a" }]);
    }
  });

  it("keeps a legitimate empty array as ok, not as a failure", async () => {
    // The distinction the whole class of bug turns on: empty is a real answer.
    respondWith({ success: true, message: "No patients found", data: [] });

    const outcome = await fetchJson<unknown[]>("/api/specialist/patients");

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.data).toEqual([]);
    }
  });

  it("forwards the request init so callers can still POST", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: "ok" })));
    vi.stubGlobal("fetch", fetchMock);

    await fetchJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({ method: "POST", body: "{}" })
    );
  });
});