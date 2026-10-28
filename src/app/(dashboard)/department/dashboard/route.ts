import { hasAnyPermission } from "@/lib/auth/helpers";
import { getRequestUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// The permissions the department records entry (save) path requires. The
// dashboard used to forward only the holders of these.
const RECORD_ENTRY_PERMISSIONS = ["records.manage", "records.manage.own_dept"];

// The same list the dashboard layout uses to decide whether a user may enter
// the department area at all.
const DEPARTMENT_AREA_PERMISSIONS = [
  "queue.manage",
  "queue.manage.own_dept",
  "records.manage",
  "records.manage.own_dept",
];

/**
 * A relative Location, so the browser resolves it against the host it asked
 * for. An absolute one is built from the server's own host name, which need
 * not be the host the session cookies belong to.
 */
function redirectTo(path: string): Response {
  return new Response(null, { status: 307, headers: { Location: path } });
}

/**
 * `/department/dashboard` is retired: it forwards to the records page. This is
 * a route handler, not a page, so the forward does not render the signed-in
 * layout first (issue #241).
 *
 * The gate the old page applied is kept. A user who may enter the department
 * area but not record results (a receptionist with `queue.manage`) is refused
 * here, as before. Anyone else is sent to the records page, whose layout gate
 * (MFA, deactivation, area rules and the access-denied audit row) decides.
 */
export async function GET() {
  const user = await getRequestUser();
  if (!user) {
    return redirectTo("/login");
  }

  if (await hasAnyPermission(user.id, RECORD_ENTRY_PERMISSIONS)) {
    return redirectTo("/department/records");
  }

  if (await hasAnyPermission(user.id, DEPARTMENT_AREA_PERMISSIONS)) {
    return redirectTo("/403");
  }

  return redirectTo("/department/records");
}
