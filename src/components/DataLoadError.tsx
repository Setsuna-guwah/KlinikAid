import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface DataLoadErrorProps {
  /** What was being loaded, phrased for a clinician. Defaults to the page subject. */
  what?: string;
  /** The underlying failure. Shown so the cause is diagnosable, never swallowed. */
  error?: unknown;
  /** Optional retry target. Omit to render a non-interactive notice. */
  retryHref?: string;
}

/**
 * The state a clinical surface must show when its data failed to load.
 *
 * This exists because a failed query and an empty result set are not the same
 * thing, and a UI that renders them identically is worse than one that fails
 * loudly. When a fetch failed, showing "No records" tells a clinician their
 * patient has no results when in fact the results could not be retrieved --
 * a confident, wrong answer that reads exactly like a real one. This component
 * makes the difference visible and says plainly that the data is unknown.
 *
 * Use it instead of `data || []`. Never fall back to an empty list on error.
 */
export function DataLoadError({
  what = "data",
  error,
  retryHref,
}: DataLoadErrorProps) {
  const detail = extractMessage(error);

  return (
    <Alert
      variant="destructive"
      role="alert"
      aria-live="assertive"
      className="border-rose-500/30 bg-rose-50/60 dark:bg-rose-950/20 py-3"
    >
      <AlertTriangle className="text-rose-500" />
      <AlertTitle className="text-rose-700 dark:text-rose-300">
        Could not load {what}
      </AlertTitle>
      <AlertDescription className="text-rose-700/90 dark:text-rose-200/80">
        <p>
          This list is empty because the request failed, not because there is
          nothing to show. Nothing below this message can be trusted until it
          loads.
        </p>
        {detail ? (
          <p className="mt-2 font-mono text-xs opacity-80">Reason: {detail}</p>
        ) : null}
        {retryHref ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-rose-300 bg-white/80 hover:bg-white dark:border-rose-800 dark:bg-transparent dark:hover:bg-rose-950/40"
          >
            <a href={retryHref}>
              <RefreshCw />
              Try again
            </a>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function extractMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string") return message;
  }
  return null;
}

export default DataLoadError;