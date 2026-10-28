/**
 * The request header the middleware writes the authenticated user's id into.
 *
 * The middleware verifies the access token's signature locally (issue #238),
 * so the id is the one the token carries. It does not prove the session is
 * still live: server code asks the Auth server that, next to the database
 * (src/lib/auth/session.ts). Server code reads this header to bind the two:
 * the locally verified identity is only accepted when it is the identity the
 * middleware verified for this request.
 *
 * A client cannot put a value in it: the middleware deletes the header from
 * the request before writing its own.
 *
 * Kept in its own module because the middleware runs in the edge runtime,
 * where the session module's dependencies are not available.
 */
export const AUTH_USER_HEADER = "x-klinikaid-auth-user";
