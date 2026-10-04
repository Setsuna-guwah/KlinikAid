import { describe, expect, it, vi } from "vitest";
import { AuthError, handleRouteError } from "./api-response";

/**
 * The defect these tests exist for: `requirePermission` / `requireAnyPermission`
 * signalled "you are not allowed" by throwing a bare `Error`, so every route
 * catch-all answered 500. Six API routes were therefore logging authorization
 * denials -- including privilege escalation attempts -- as server faults.
 *
 * The status now travels on the error, so the assertion is about the status the
 * caller sees, not about the internal shape of the thrown value.
 */

async function bodyOf(response: Response) {
  return (await response.json()) as { success: boolean; message: string };
}

describe("handleRouteError", () => {
  it("answers 401 for a missing session", async () => {
    const response = handleRouteError(
      new AuthError(401, "UNAUTHORIZED: Session not found"),
      "Failed to fetch department queue"
    );

    expect(response.status).toBe(401);
    const body = await bodyOf(response);
    expect(body.success).toBe(false);
    expect(body.message).toBe("Unauthorized: Please sign in.");
  });

  it("answers 403 for a missing permission", async () => {
    const response = handleRouteError(
      new AuthError(403, "FORBIDDEN: Missing permission 'staff.manage'"),
      "Failed to list staff"
    );

    expect(response.status).toBe(403);
    expect((await bodyOf(response)).message).toBe("Forbidden: Access denied.");
  });

  it("does not tell the caller which permission was missing", async () => {
    const response = handleRouteError(
      new AuthError(403, "FORBIDDEN: Missing one of permissions 'staff.manage, profiles.manage'"),
      "Failed to list staff"
    );
    const raw = JSON.stringify(await bodyOf(response));

    expect(raw).not.toContain("staff.manage");
  });

  it("keeps the route's own 500 for anything unexpected", async () => {
    const response = handleRouteError(new Error("connection reset"), "Failed to list staff");

    expect(response.status).toBe(500);
    expect((await bodyOf(response)).message).toBe("Failed to list staff");
  });

  it("survives a thrown non-Error", async () => {
    const response = handleRouteError("something odd", "Failed to list staff");

    expect(response.status).toBe(500);
    expect((await bodyOf(response)).message).toBe("Failed to list staff");
  });

  it("still reaches `instanceof Error` checks and error boundaries", () => {
    const error = new AuthError(403, "FORBIDDEN: Missing permission 'staff.manage'");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("FORBIDDEN: Missing permission 'staff.manage'");
  });

  it("logs the refusal with its status, so the audit trail keeps the distinction", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    handleRouteError(new AuthError(403, "FORBIDDEN: Missing permission 'staff.manage'"), "Failed to list staff");

    expect(logged).toHaveBeenCalledWith(
      "API Error Response [403]: Forbidden: Access denied.",
      "FORBIDDEN: Missing permission 'staff.manage'"
    );
    logged.mockRestore();
  });
});