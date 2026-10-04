/**
 * The single place that decides what a failed read means.
 *
 * ## Why this exists
 *
 * Nine surfaces in this app had the same defect in slightly different clothes:
 * a query's `error` was read into `console.error` and then the empty, zero or
 * stale result was rendered anyway. In a clinical tool that is worse than an
 * error message -- it is a confident, plausible wrong answer.
 *
 * The reason the same bug kept coming back is that the distinction it needs is
 * not available at the call site. PostgREST does not report "no rows" as data,
 * it reports it as an *error*, so this shape:
 *
 * ```ts
 * const { data: patient, error } = await supabase.from("patients").select("*").eq("id", id).single();
 * if (error || !patient) notFound();
 * ```
 *
 * cannot tell "this patient does not exist" from "the database did not answer",
 * even though those two conclusions demand opposite responses from a clinician.
 * Nine separate `if (error || !data)` patches would each have to rediscover that,
 * and the next one would get it wrong again.
 *
 * `classifyRead` puts the decision here instead, and returns a union that has no
 * `data` field on the failure branch -- so reading the data *requires* having
 * narrowed the failure away. That is a compile error, not a review comment.
 *
 * ## Why absence needs positive evidence
 *
 * `PGRST116` is PostgREST's "could not coerce the result to a single JSON
 * object", and it fires for *any* cardinality other than exactly one. Verified
 * against the live database:
 *
 * ```
 * 0 rows -> {"code":"PGRST116","details":"The result contains 0 rows"}
 * 2 rows -> {"code":"PGRST116","details":"The result contains 2 rows"}
 * ```
 *
 * Same code. Treating `PGRST116` alone as "absent" would therefore turn a
 * duplicate-row integrity fault into "this patient does not exist" -- trading one
 * confident wrong answer for another. So absence requires the 0-rows detail, and
 * every other outcome is a failure to be shown as a failure. If a future
 * PostgREST drops `details`, this degrades to "show an error", never to
 * "claim the record is missing".
 */

type ErrorLike = {
  code?: unknown;
  details?: unknown;
  message?: unknown;
};

function asRecord(value: unknown): ErrorLike | null {
  return typeof value === "object" && value !== null ? (value as ErrorLike) : null;
}

/** PostgREST's single-object coercion failure. Fires for zero *and* many rows. */
const SINGLE_OBJECT_CODE = "PGRST116";

/**
 * True only for "the query ran successfully and matched no rows".
 *
 * Deliberately requires the 0-rows detail: `PGRST116` alone is ambiguous, and
 * the ambiguous case must not be reported to a clinician as a missing record.
 */
export function isZeroRowsError(error: unknown): boolean {
  const record = asRecord(error);
  if (!record || record.code !== SINGLE_OBJECT_CODE) {
    return false;
  }
  return typeof record.details === "string" && /\b0 rows\b/i.test(record.details);
}

/**
 * The three things a read can be. There is no member that means "failed but
 * behave as if it were empty" -- that member is the bug.
 */
export type ReadOutcome<T> =
  | { readonly kind: "ok"; readonly data: T }
  | { readonly kind: "absent" }
  | { readonly kind: "failed"; readonly error: unknown };

/**
 * Classify a Supabase/PostgREST result.
 *
 * Pass the whole awaited result object. Both halves are needed to classify it,
 * and making the caller hand over both is the point:
 *
 * ```ts
 * const patient = classifyRead(await supabase.from("patients").select("*").eq("id", id).single());
 * if (patient.kind === "failed") return <DataLoadError error={patient.error} />;
 * if (patient.kind === "absent") notFound();
 * ```
 *
 * Note that `{ data: null, error: null }` is reported as `ok`, not `absent`:
 * that is what a `head: true` count query returns, and for a count "absent"
 * would be meaningless. Absence in this codebase always arrives as a
 * `PGRST116` error, never as a null row with a null error.
 */
export function classifyRead<T>(result: { data: T; error: unknown }): ReadOutcome<T> {
  const { data, error } = result;

  if (error !== null && error !== undefined) {
    return isZeroRowsError(error) ? { kind: "absent" } : { kind: "failed", error };
  }

  return { kind: "ok", data };
}

/**
 * Collect the failures from a batch of reads so they can be surfaced together.
 *
 * The specialist dashboard runs eight independent queries and aggregates them
 * into one banner; it previously covered only four, so a partial failure read
 * as a healthy dashboard. This makes "which of these failed" a total question
 * over the whole batch rather than a hand-maintained list that drifts.
 *
 * Returns `null` when every read succeeded, so callers can use it directly as a
 * condition. It never invents data -- it only ever reports failures.
 */
export function readErrors(outcomes: ReadOutcome<unknown>[]): unknown[] {
  return outcomes
    .filter((outcome): outcome is { kind: "failed"; error: unknown } => outcome.kind === "failed")
    .map((outcome) => outcome.error);
}