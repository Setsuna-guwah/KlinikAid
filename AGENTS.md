# KlinikAid — agent notes

Clinical laboratory information system. Next.js 14 (App Router), TypeScript strict,
Supabase (Postgres + Auth + RLS), Tailwind. Multi-role: admin, receptionist,
department_staff, medical_specialist, patient.

## Setup

```bash
sudo apt install -y nodejs npm     # Node 20.19.2
npm ci                             # ~30s, 725 packages
cp .env.example .env.local         # then fill in the 3 Supabase values
```

`.env.local` is gitignored. It holds a **real service-role key** — never commit it, never
put its values in a file that gets tracked.

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` (add `-- -p <port>` to pick one) |
| Typecheck | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Unit tests | `npm test` (`npx vitest run`; `--watch` via `npm run test:watch`) |

**`npm run review` is broken** — it invokes `node scripts/review.js` and no `scripts/`
directory exists. Don't rely on it.

## Verification

A clean `master` is:

```
npx tsc --noEmit   -> exit 0
npm run lint       -> no warnings or errors
npm run build      -> Compiled successfully, 37/37 static pages
npm test           -> 24 passed (2 files)
```

`next build` runs ESLint, so **a lint error fails the build**.

The build needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to be
present or `/reset-password` fails to prerender. To check the build without real
credentials, pass them inline — do **not** write a `.env.local` full of placeholders:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build
```

### What the test suite does and does not cover

Vitest, `src/**/*.test.ts`, node environment, no DOM. It covers the two central
modules that the "a failed query is not an empty query" fixes depend on:

- `src/lib/read-outcome.ts` — `classifyRead`, the three-way read classifier.
- `src/lib/fetch-json.ts` — `fetchJson`, the client-side outcome wrapper.

**Not covered: component rendering.** There are no jsdom/`@testing-library` tests, so
"does this page actually render `DataLoadError`" is still answered by reading the code or
clicking through the app. The load-bearing guarantee for the call sites is a *compile-time*
one instead: `classifyRead` and `fetchJson` return unions whose failure branch has no `data`
member, so reading the payload without handling the failure is a `tsc` error. `tsc --noEmit`
is therefore part of the contract, not just a type check.

There are **no credentials for any role in the repo**, so the auth-gated pages cannot be
driven in a browser. Unauthenticated requests 307 to `/login`; that is as far as you can
verify without a session. Say so in a PR rather than implying a page was exercised.

## Reading data without confusing a failure for an empty result

`src/lib/DataLoadError`-style error surfaces exist because a failed query and an empty
result are different claims. Two helpers now enforce that centrally — **use them instead of
writing a new `if (result.success)`**:

```ts
// server component / route handler
const read = classifyRead(await supabase.from("patients").select("*").eq("id", id).single());
if (read.kind === "failed") return <DataLoadError error={read.error} />;
if (read.kind === "absent") notFound();
const patient = read.data;

// client component
const out = await fetchJson<Logs>("/api/admin/logs/system");
if (out.kind === "failed") { setError(out.error); return; }
setLogs(out.data.logs);
```

Two PostgREST facts that make this necessary, both confirmed against the live DB:

- `.single()` reports **zero rows as an error** (`PGRST116`), not as `data: null`. So
  `if (error || !data) notFound()` cannot tell "no such patient" from "the database did not
  answer".
- `PGRST116` fires for **many rows too** (`details: "The result contains 2 rows"`), which is
  why `isZeroRowsError` checks `details` and not just the code.

**Residual limit, not fixable client-side:** RLS *filters* rows out rather than erroring, so
a policy that hides a row is byte-identical on the wire to a row that does not exist. `roles`
has 10 rows under the service role and reads as "0 rows" to `anon`. `classifyRead` cannot
distinguish those two. Do not read `absent` as proof the row is gone.

## Browser access — read this

The in-app browser **cannot reach `localhost`**. It runs in a separate network namespace
and returns `net::ERR_CONNECTION_REFUSED` while `curl localhost:3000` works fine from the
shell. Use the environment-port target, which resolves to the box's Tailscale hostname:

```
{ target: { kind: "environment-port", port: 3000 } }
```

That resolves to `http://jonkler.tail050666.ts.net:3000`. The raw IP
`http://100.68.76.119:3000` also works if you need a literal URL. A dev server must be
listening before you navigate; Next.js binds all interfaces by default.

## Ports and worktrees

Parallel sessions each need their own worktree and their own port.

| Path | Branch | Port |
|---|---|---|
| `/home/jonkler/code/Klinikaid` | `master` | 3000 |
| `/home/jonkler/code/Klinikaid-triage` | `fix/triage-transaction` | 3001 |
| `/home/jonkler/code/Klinikaid-migrations` | `chore/migration-history` | 3002 |

Port 5173 is taken by an unrelated project (`faculty-mis-prototype`) — avoid that range.

Each worktree needs its own `node_modules` (`npm ci`, ~20s). For `.env.local`, symlink
rather than copy so there is one copy of the service-role key on disk:

```bash
ln -sf /home/jonkler/code/Klinikaid/.env.local .env.local
```

A worktree does **not** inherit untracked or gitignored files from the main checkout, so
without that symlink `next build` fails on the missing env vars.

## Git workflow

- `master` is **protected** — direct pushes are rejected. Branch, then PR.
- Squash-merge. The remote is HTTPS (`gh auth setup-git`); there is no GitHub SSH key on
  this box, so an SSH remote will fail with `Permission denied (publickey)`.
- Commit style is conventional commits with a scope, and the body explains *why*:
  `fix(ui): stop deriving the queue-age badge from Date.now() during render`
- `.gitattributes` sets `* text=auto eol=lf`. Without it a Windows checkout rewrites every
  tracked file to CRLF — 90 files appear modified with 25529 insertions against 25529
  deletions, and the whole diff is churn. If you ever see that, check for a CRLF
  round-trip before believing the diff.

## Domain notes worth knowing before changing code

- **Authorization resolves through `role_id` → `role_permissions`, not the legacy `role`
  text column** — except `src/middleware.ts:34-45`, which still reads `profiles.role` for
  its post-login redirect. Worth knowing if you touch role handling.
- **`src/lib/db/schema.sql` is a second, drifting source of truth** alongside
  `src/lib/db/migration_*.sql`. There is no `supabase/migrations/` directory and no
  recorded migration history, so "this migration was applied" is not a verifiable claim —
  it has to be checked against the live database.
- `specialist_records.specialist_patient_id` is `ON DELETE CASCADE`, which is why
  specialist patients are archived via `archive_specialist_patient()` rather than deleted.
- RLS is the only boundary: `anon` holds full table privileges on all public tables, so
  every table depends on its policies being correct.

`SECURITY-FIX-REVIEW.md` in the repo root is a retrospective on 13 direct-to-master
commits. Its §3 lists what was **not** verified and §5 lists residual risk — read it
before assuming a fix is complete.
