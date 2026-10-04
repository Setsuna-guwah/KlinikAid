/**
 * The single place that turns a browser `fetch` into something that cannot be
 * mistaken for data.
 *
 * ## Why this exists
 *
 * The client-side half of the failed-query defect class looked like this, at
 * least six times:
 *
 * ```ts
 * const result = await res.json();
 * if (result.success) { setRecords(result.data); }
 * ```
 *
 * There is no `else`. On failure the previous state survives untouched, so the
 * UI shows the *last successful* answer under the *new* filter's label. On the
 * specialist analytics page that meant a Hemoglobin selector above a Glucose
 * chart, with the glucose reference range still captioned "Normal limit" --
 * confidently wrong clinical data that looks correct.
 *
 * The failure is structural, not accidental: `result.data` is reachable whether
 * or not the request worked, and a bare object does not make the caller account
 * for the failure branch. A toast does not help either -- it is a transient
 * overlay, and by the time it is read the wrong chart is back on screen.
 *
 * `fetchJson` returns a union instead. The `failed` branch has no `data`
 * member, so reaching for the payload is a type error until the failure has
 * been handled, and the state that was going to be overwritten is left with
 * nothing to put in it.
 */

export class ApiError extends Error {
  readonly status: number;

  /** Server-provided diagnostic detail, for logs. Never rendered verbatim. */
  readonly detail: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export type FetchOutcome<T> =
  | { readonly kind: "ok"; readonly status: number; readonly data: T }
  | { readonly kind: "failed"; readonly status: number; readonly error: ApiError };

type Envelope = {
  success?: unknown;
  message?: unknown;
  data?: unknown;
  debug_details?: unknown;
};

function asEnvelope(body: unknown): Envelope {
  return typeof body === "object" && body !== null ? (body as Envelope) : {};
}

/**
 * Fetch a JSON API response as an outcome, never as a bare payload.
 *
 * Understands the `{ success, message, data }` envelope from
 * `src/lib/api-response.ts`, and treats all three of these as failures:
 *
 * - the request never completed (offline, DNS, aborted);
 * - the response was not JSON (a proxy error page, an HTML 502);
 * - the response was HTTP 2xx but carried `success: false`.
 *
 * That last one matters. `res.ok` is true for the 200-with-`success:false`
 * shape, so `res.ok` on its own is not a success check -- treating it as one is
 * how a failed query becomes an empty table.
 *
 * ```ts
 * const outcome = await fetchJson<{ logs: Log[] }>(url);
 * if (outcome.kind === "failed") {
 *   setError(outcome.error);   // render DataLoadError in place of the list
 *   return;
 * }
 * setLogs(outcome.data.logs);
 * ```
 */
export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<FetchOutcome<T>> {
  let response: Response;

  try {
    response = await fetch(input, init);
  } catch (cause) {
    return {
      kind: "failed",
      status: 0,
      error: new ApiError("The request could not be sent.", 0, cause),
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    return {
      kind: "failed",
      status: response.status,
      error: new ApiError(
        `The server returned a response that was not JSON (HTTP ${response.status}).`,
        response.status,
        cause
      ),
    };
  }

  const envelope = asEnvelope(body);
  const message = typeof envelope.message === "string" ? envelope.message : null;
  const detail = "debug_details" in envelope ? envelope.debug_details : body;

  if (!response.ok) {
    return {
      kind: "failed",
      status: response.status,
      error: new ApiError(
        message ?? `The request failed (HTTP ${response.status}).`,
        response.status,
        detail
      ),
    };
  }

  // 2xx with success:false is a failure, not a success.
  if (envelope.success === false) {
    return {
      kind: "failed",
      status: response.status,
      error: new ApiError(message ?? "The request failed.", response.status, detail),
    };
  }

  // A route that returns an unwrapped payload is still usable; only the
  // envelope shape gets unwrapped.
  return {
    kind: "ok",
    status: response.status,
    data: (envelope.success === true ? envelope.data : body) as T,
  };
}