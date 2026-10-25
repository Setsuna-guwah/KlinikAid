# Supabase Edge Function: `password-sign-in`

Password sign-in behind the same attempt limiter as web's login page (#70).
Mobile calls this instead of `signInWithPassword` directly, because Supabase's
password-verification hook is not available on the current plan. Web's
loginAction already uses the limiter, so the rules are the same: 5 attempts per
(email, IP) per 15 minutes, TOTP codes counted against that limit, one-time TOTP
codes, and fail closed.

Logic and ordering: `src/lib/auth/password-sign-in.ts`, unit-tested by
`src/lib/auth/password-sign-in.test.ts` (run by `npm test` in CI).
This folder only binds Supabase clients to those ports.

**Not deployed.** Deployment is the owner's call after review.

## Deploy

This project has no `supabase/config.toml`, so JWT verification must be disabled
on the command line. The caller has no session yet.

```bash
supabase functions deploy password-sign-in --no-verify-jwt
```

Secrets are not set by this function. It uses the auto-provided
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Without
them it returns 503 `auth_unavailable`.

Requires migration_27 (`begin_login_attempt`, `refund_login_attempt`,
`clear_login_attempts`, `claim_totp_code`), already in the repo.

Before deploying to production, confirm on staging:

- Which `x-forwarded-for` hop is the caller (see Client IP). If the last hop is
  a constant gateway address, every caller shares one bucket per email, and a
  stranger can lock a clinician out.
- Which IP GoTrue's own per-IP limit counts for these server-side calls. If it
  counts the function's egress address, all mobile sign-ins share one
  30-per-5-minutes sign-in bucket and one token-verification bucket.
- The GoTrue error codes for a wrong TOTP code and a foreign factor.
- `deno check --config deno.json index.ts` passes (it does at this commit with
  Deno 2.1.4), and the deploy bundles `src/lib/auth/*` through the import map.

## Request

```
POST /functions/v1/password-sign-in
Content-Type: application/json
```

Password step (no session yet):

```json
{ "action": "password", "email": "clinician@example.com", "password": "..." }
```

TOTP step (the `access_token` from the password step's `session`, which is aal1):

```
Authorization: Bearer <aal1 access_token>
```
```json
{ "action": "totp", "factor_id": "<factor_id from the password step>", "code": "123456" }
```

Email is taken from the bearer token's user, never from the body. Whitespace in
`code` is removed. `code` must be six digits.

## Response contract

Every body is JSON. Successes return `session`, the GoTrue session object
unchanged (`access_token`, `refresh_token`, `expires_in`, `expires_at`,
`token_type`, `user`). The session in the password step is aal1, and the one in
the TOTP step is aal2.

| Step | Outcome | HTTP | Body |
|---|---|---|---|
| password | Signed in, no second factor | 200 | `{ "mfa_required": false, "session": {...} }` |
| password | Password correct, TOTP needed | 200 | `{ "mfa_required": true, "factor_id": "...", "session": {...aal1} }` |
| password | Wrong email or password | 400 | `{ "code": "invalid_credentials" }` |
| password | Email not confirmed | 403 | `{ "code": "email_unconfirmed" }` |
| password | Account deactivated (banned in Auth) | 403 | `{ "code": "account_deactivated" }` |
| password | Locked by this limiter | 429 | `{ "code": "login_locked", "retry_after_seconds": N }` + `Retry-After: N` |
| password | GoTrue's own rate limit | 429 | `{ "code": "auth_rate_limited" }` |
| password | Limiter unreachable (fail closed) | 503 | `{ "code": "limiter_unavailable" }` |
| password | GoTrue or network unreachable | 503 | `{ "code": "auth_unavailable" }` |
| password | Second-factor state unreadable, or no verified TOTP factor | 503 | `{ "code": "mfa_unavailable" }` |
| totp | Signed in with TOTP | 200 | `{ "mfa_required": false, "session": {...aal2} }` |
| totp | No bearer token, or the token no longer resolves | 401 | `{ "code": "unauthorized" }` |
| totp | Wrong code | 400 | `{ "code": "invalid_totp" }` |
| totp | Code already used | 400 | `{ "code": "totp_reused" }` |
| totp | Factor not owned by the token's user | 400 | `{ "code": "invalid_factor" }` |
| totp | Locked by this limiter | 429 | `{ "code": "login_locked", "retry_after_seconds": N }` + `Retry-After: N` |
| totp | GoTrue's own rate limit | 429 | `{ "code": "auth_rate_limited" }` |
| totp | Limiter unreachable (fail closed) | 503 | `{ "code": "limiter_unavailable" }` |
| totp | GoTrue or network unreachable | 503 | `{ "code": "auth_unavailable" }` |
| totp | Account deactivated (banned in Auth) | 403 | `{ "code": "account_deactivated" }` |
| either | Missing or malformed fields, or unknown action | 400 | `{ "code": "invalid_request" }` |
| either | Method other than POST or OPTIONS | 405 | `{ "code": "method_not_allowed" }` + `Allow: POST, OPTIONS` |

`retry_after_seconds` is clamped to 1..900 (`LOGIN_WINDOW_SECONDS`), the length
of one lock. Mobile should show "Try again in N minutes", rounding up like web.

Error bodies never contain the submitted password, the code, or any token.

## Order of operations

**Password:** validate, then count (`begin_login_attempt`) before the password
is checked, then `signInWithPassword`. If a TOTP factor is pending, refund the
attempt and return the aal1 session. Otherwise clear the counter.

**TOTP:** validate, then resolve the user from the bearer token, then count, then
claim the code (`claim_totp_code`), then challenge and verify with GoTrue. On
success, clear the counter. A replayed code never reaches GoTrue.

Refund and clear are best effort and logged on failure, as in web. A failed clear
leaves the counter in place. A failed refund costs the user one attempt.

## Client IP

The limiter key uses the **last** `x-forwarded-for` hop. Proxies append the
address they observed, so the last hop is what the platform recorded. The first
hop is whatever the client sent, and a client can rotate it to get fresh buckets.
Web's loginAction still uses the first hop, which is a known gap there.

Open question: which header the Supabase gateway sets or overwrites was not
confirmed from documentation. Check on staging by echoing the request headers
before relying on the key. A missing header means IP `""`, shared by every
request without one, as web does.

## Remaining exposure

- **Direct sign-in still bypasses this limiter.** `signInWithPassword` with the
  public anon key, sent to GoTrue, is not counted. Only the password-verification
  hook could cover that, and it needs a paid plan. Supabase's own per-IP limit
  (30 per 5 minutes on sign-in) still applies.
- **Mobile must switch to this endpoint** in a follow-up PR. Until it does,
  mobile sign-in remains uncounted.
- **Current-password checks** (web's `verifyCurrentPassword`, mobile's
  `changePassword`) are not covered by this function.
- **TOTP replay check runs before GoTrue verifies the code.** A code that
  GoTrue rejects for a transient reason is recorded as used for up to 5 minutes.
  The user then waits for the next code.
- The endpoint does not check `profiles.is_active` or the role, as web's
  loginAction does after sign-in. It adds no new exposure, because mobile's
  direct path issues the same session. Mobile must keep those checks.
- No audit log events are written, unlike web's LOGIN_FAILED and LOGIN_SUCCESS.
- Supabase's verify call signs out the user's other sessions. This is existing
  behaviour on web's TOTP path as well.
