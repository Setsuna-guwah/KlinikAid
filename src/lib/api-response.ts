import { NextResponse } from "next/server";

/**
 * A refusal that already knows which HTTP status it is.
 *
 * The guards in `src/lib/auth/helpers.ts` throw this instead of a bare `Error`
 * so that the status travels with the error. Without it, every route catch-all
 * has to treat "you may not do that" as "the server is broken": the throw
 * carries no status, so the catch maps it to 500. That is how six routes came to
 * report unauthenticated calls -- and privilege escalation attempts -- as server
 * faults, invisible to 401/403 alerting and indistinguishable from an outage in
 * the audit trail.
 *
 * The messages are kept verbatim from the previous bare `Error`s so that the
 * server logs (and the dashboard error boundary, which renders `error.message`)
 * read exactly as they did before.
 */
export class AuthError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

const AUTH_MESSAGES: Record<401 | 403, string> = {
  401: "Unauthorized: Please sign in.",
  403: "Forbidden: Access denied.",
};

/**
 * Standard Success API Response Helper.
 */
export function successResponse<T>(data: T, message?: string, status = 200) {
  return NextResponse.json(
    {
      success: true,
      message: message || "Operation completed successfully",
      data,
    },
    { status }
  );
}

/**
 * Standard Error API Response Helper.
 * Sanitizes errors and returns generic message structures to clients (Rule 7).
 */
export function errorResponse(message: string, status = 400, details?: unknown) {
  // If in production, prevent leaking deep database/runtime logs (Rule 7)
  const isDev = process.env.NODE_ENV === "development";
  
  if (details) {
    console.error(`API Error Response [${status}]: ${message}`, details);
  } else {
    console.error(`API Error Response [${status}]: ${message}`);
  }

  return NextResponse.json(
    {
      success: false,
      message,
      ...(isDev && details ? { debug_details: details } : {}),
    },
    { status }
  );
}

/**
 * The single place a route handler's `catch` turns a thrown value into a status.
 *
 * An `AuthError` keeps its own 401/403 and answers with a generic message --
 * which permission was missing is a server-side detail, not something to hand
 * back to the caller. Anything else is an unexpected fault and keeps the route's
 * own 500 message.
 *
 * ```ts
 * try {
 *   const profile = await requirePermission("staff.manage");
 *   ...
 * } catch (error: unknown) {
 *   return handleRouteError(error, "Failed to list staff");
 * }
 * ```
 */
export function handleRouteError(error: unknown, fallbackMessage: string) {
  if (error instanceof AuthError) {
    return errorResponse(AUTH_MESSAGES[error.status], error.status, error.message);
  }

  const details = error instanceof Error ? error.message : String(error);
  return errorResponse(fallbackMessage, 500, details);
}
