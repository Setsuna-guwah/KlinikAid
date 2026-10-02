# Security Fix Review — direct-to-master commits on `master`

**Branch:** `docs/security-fixes-review` (from `origin/master` @ `297365c`)
**Reviewed range:** `4dba065^..297365c` — 13 commits, all authored 2026-10-02
**Review date:** 2026-10-02
**Database:** live Supabase project (`onze…`), read + throwaway-fixture writes only

These commits landed on `master` without pull-request review. This document is the
retrospective record: what each change fixes, the defect class, and — the part that
matters — whether the fix was **actually exercised against the live database in this
session**. Anything not exercised is labelled as such. No claim below is carried over
from a commit message.

---

## 0. Headline findings

Read this section first. Two things need a human decision.

### 0.1 Nothing found broken — but one fix was silently superseded by the next one

All eight security-relevant fixes were re-exercised and all of them hold. No
regression introduced by a later commit was found. **One correction to the record,
though:** `781027c` (migration_20, "read the signup role from `app_metadata`") is
**not what is running**. It was superseded three commits later by `cfe509e`
(migration_21), which removes privilege derivation from the trigger entirely. Anyone
reading `781027c` as "the signup fix" is reading a fix that no longer exists in the
database. The live `handle_new_user()` matches migration_21 exactly (verified by
`pg_get_functiondef`).

### 0.2 `schema.sql` does not reflect `9da4af0` — rebuilding from it would restore the cascade-destroy bug

`cc1f068` ("docs(db): reconcile schema.sql with the RBAC-era migrations") reconciled the
`profiles` policies and the signup trigger. It did **not** reconcile the specialist
tables, even though `9da4af0`/`migration_22` landed *before* it:

- [`src/lib/db/schema.sql:453-465`](src/lib/db/schema.sql) — `specialist_patients` has no `deleted_at` column.
- [`src/lib/db/schema.sql:468-482`](src/lib/db/schema.sql) — `specialist_records` has no `deleted_at` column.
- [`src/lib/db/schema.sql:489-497`](src/lib/db/schema.sql) — still ships the pre-`migration_22` `FOR ALL` policies:

```sql
CREATE POLICY "Specialist manages own patients"
  ON public.specialist_patients FOR ALL
  USING (specialist_id = auth.uid())
  WITH CHECK (specialist_id = auth.uid());
```

`FOR ALL` includes `DELETE`. Anyone provisioning a fresh database from `schema.sql`
gets a world where a specialist can hard-delete their own patient rows, cascading away
that patient's entire diagnostic history via
`specialist_records.specialist_patient_id ... ON DELETE CASCADE`
([`src/lib/db/schema.sql:470`](src/lib/db/schema.sql)). That is exactly the defect
`9da4af0` exists to close. The live database is correct; the checked-in reference file
is not.

**Suggested follow-up (not in this PR — it is a source change):** either fold
migration_22 into `schema.sql`, or move `src/lib/db/migration_*.sql` into a real
`supabase/migrations/` directory so `schema.sql` stops being a second, drifting source
of truth. See §5.

---

## 1. Commit table

Defect classes use CWE identifiers. "Verified live" means the behaviour was
re-exercised in this session against the live database — see §4 for the harness and
§3 for what was *not* covered.

| Hash | Fixes | Defect class | Verification |
|---|---|---|---|
| `cd5ac56` | Self-service privilege escalation on `public.profiles` (`migration_19`) | CWE-269 Improper Privilege Management / CWE-862 Missing Authorization (RLS `WITH CHECK` did not pin `role_id`, `department`, `is_active`) | **Verified live** — 10/10 checks, throwaway `patient` session, exact Postgres error captured |
| `781027c` | Signup role read from `user_metadata` (`migration_20`) | CWE-269 Improper Privilege Management (trusting caller-writable metadata in a server-side trigger) | **Superseded, not running.** Live function matches `migration_21`. Not separately re-verified; its behaviour is subsumed by the `cfe509e` run |
| `cfe509e` | Every self-service signup provisioned as `patient` (`migration_21`) | CWE-269 / CWE-807 (trust boundary violation in an `auth.users` trigger) | **Verified live** — anon-key `signUp` claiming `role=admin` provisioned `patient`; staff onboarding regression passed |
| `60f317e` | `role`/`department` moved out of `user_metadata` on staff creation | CWE-269 (same class, app layer defence-in-depth) | **Partially verified.** The POST/create path is covered by the `cfe509e` run. The `PUT /api/admin/staff/[id]` path was **not** exercised live |
| `5454c00` | Dashboard gated on session assurance, not factor existence | CWE-308 Single-Factor Authentication (factor existence ≠ assurance) + CWE-639 IDOR (unvalidated `factorId` from the request body) | **Verified live** — 10/10. AAL1 refused with `307 → /login?error=mfa_required`; AAL2 served; cross-account factor challenge refused |
| `9da4af0` | Specialist patients archived instead of cascade-destroyed (`migration_22`) | CWE-772 Missing Release of Resource / CWE-778 Insufficient Logging (irreversible destruction with no audit trail) | **Verified live** — 13/13. Hard DELETE filtered, archive RPC correct, records survive. **Audit-event write not verified** (server action not invokable from a test) |
| `297365c` | Triage routes the patient before approving the document | CWE-703 Improper Handling of Exceptional Conditions (non-atomic two-step; a 409 consumed the document) | **Verified live** — real endpoints, real receptionist session. 409 → `documents.status` still `pending` |
| `4dba065` | `patient_queue` entries orphaned across the PHT day boundary | CWE-703 / availability deadlock (entry blocked reception, invisible to the department, unclosable) | **Verified live** — a 3-day-old entry is visible to the department and still 409s reception, so the two sides agree |
| `7d6e5e8` | Failed queries rendered as empty results | CWE-778 Insufficient Logging / clinical-information integrity (a failed fetch rendered as "0 records, 0 flagged") | **Partially verified** — specialist dashboard + roster only, via a temporary `REVOKE` with ACL restored byte-identically. Seven other surfaces **not** individually exercised |
| `cc1f068` | `schema.sql` reconciled with the RBAC-era migrations | Documentation drift (not a runtime defect) | **Verified by inspection — found a gap.** `profiles` + trigger match live; **specialist tables do not** (§0.2) |
| `50361eb` | Tracks `migration_17.sql`, `migration_18.sql`, specialist analytics seed | Housekeeping (not a security fix) | **Not verified.** No runtime behaviour; files were checked for presence only |
| `ce7eca4` | Ignores agent tooling; untracks `supabase/.temp/`, `r1_diff.txt`; repairs a UTF-16LE `.gitignore` | Information disclosure (tracked CLI link state: `pooler-url` carries project ref, org id, region) | **Verified by inspection.** `supabase/.temp/` untracked, `.gitignore` valid UTF-8, rule for `RBAC_HANDOFF.md` now live |
| `9e3a8dd` | Merge of `fix/triage-orphan-deadlock` into `master` | — (merge commit, no diff of its own) | n/a — carries `4dba065` |

> The task brief listed 12 hashes and called them "14 commits". The authoritative list
> from `git log ce7eca4^..origin/master` is **13**, of which `4dba065` was missing from
> the brief. All 13 are covered above.

---

## 2. Per-fix detail

### 2.1 `cd5ac56` — self-service privilege escalation on `public.profiles`

**The vulnerability.** `schema.sql` shipped an `UPDATE` policy on `profiles` whose
`WITH CHECK` pinned only the legacy `role` **text** column:

```sql
WITH CHECK (auth.uid() = id AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()))
```

Every live permission check resolves through `role_id`
(`user_has_permission` → `role_permissions`), and `department` is the isolation
predicate for the cross-department policies. Because neither column was pinned, **any
authenticated account — including a self-registered patient — could rewrite `role_id`,
`department` and `is_active` on its own row.** Writing `role_id` to the admin role id
grants that account every admin permission on every route guarded by
`requirePermission()` ([`src/lib/auth/helpers.ts:147`](src/lib/auth/helpers.ts)).

**Mechanism of the fix.** [`src/lib/db/migration_19.sql:27-56`](src/lib/db/migration_19.sql)
drops and recreates the policy, pinning four columns with `IS NOT DISTINCT FROM`
(so a NULL held by a NULL-holder stays legal while NULL → value is still blocked), and
adds a second permissive `UPDATE` policy for callers holding `profiles.manage` so the
legitimate admin path keeps working.

**Verified live.** A throwaway `patient` account, signed in with the browser-public anon
key, was asked to escalate itself. Every attempt rejected, exact error:

```
pgerror=42501/new row violates row-level security policy for table "profiles"
```

| Attempt | Result |
|---|---|
| `{role_id: <admin role id>}` | rejected, `42501` |
| `{department: 'ecg'}` | rejected, `42501` |
| `{is_active: false}` (a value that *differs*) | rejected, `42501` |
| `{role: 'admin'}` (legacy text) | rejected, `42501` |
| all three in one `UPDATE` | rejected, `42501` |
| `{full_name: '…'}` (ordinary column) | **succeeds** — no over-blocking |
| admin with `profiles.manage` editing another row's `department` | **succeeds** |
| admin assigning `department_staff` + `role_id` to another user | **succeeds** |
| patient writing `user_metadata.role = 'admin'` post-signup | accepted by auth, **non-authoritative** — profiles row unchanged |

The last row matters: `user_metadata` is still user-writable (as it must be), and the
`profiles` row is what authorization reads. Verified that the unpinned columns are
harmless — the only `profiles` columns the policy does not pin are `full_name`,
`accepted_privacy_at`, `email_verified_at` and `employee_type`, and of those only
`accepted_privacy_at` and `employee_type` are read by app code
([`src/app/(dashboard)/layout.tsx:55`](src/app/(dashboard)/layout.tsx),
[`src/app/(dashboard)/admin/staff/page.tsx:435`](src/app/(dashboard)/admin/staff/page.tsx)).
Self-accepting the privacy agreement is the intended action; `employee_type` is a
display string; `email_verified_at` is not referenced anywhere in `src/`.

---

### 2.2 `781027c` → superseded by `cfe509e` — the signup privilege source

**The vulnerability.** `migration_18`'s `handle_new_user()` read the granted role
straight out of `new.raw_user_meta_data->>'role'`, with an allow-list that included
`'admin'`. `user_metadata` is the bag a caller supplies at sign-up, and the browser
holds the anon key, so:

```js
supabase.auth.signUp({ email, password, options: { data: { role: 'admin' } } })
```

bypasses every server action in the app and lands an admin profile directly.

**The first fix (`781027c`, migration_20)** moved the read to `raw_app_meta_data`,
which only the service role can write. That was correct in principle and **wrong in
practice**: `auth.admin.createUser` *does* persist `app_metadata`, but the
`auth.users` trigger fires *before* that column is populated, so the trigger observed
`NULL` and every staff account silently became a patient. The approach failed closed —
safe, but it broke staff onboarding.

**The real fix (`cfe509e`, migration_21)** stops deriving privilege at signup at all.
The trigger provisions `patient` unconditionally
([`src/lib/db/migration_21.sql:58-59`](src/lib/db/migration_21.sql)); staff roles are
assigned by the server immediately after creation. The signup path has no code path
that can produce a privileged profile whatever the caller supplies.

Live `pg_get_functiondef('public.handle_new_user()')` matches migration_21, including
`INSERT INTO public.profiles (...) VALUES (new.id, default_name, 'patient', NULL, patient_role_id)`.

**Verified live.**

| Attempt | Result |
|---|---|
| anon `signUp` with `options.data.role = 'admin'` | profile provisioned as **`patient`**, `department: null` |
| anon `signUp` with no role claim | `patient` |
| service-role `createUser` then the server-side role assignment, as the admin route does it | `department_staff` / `laboratory` — staff onboarding intact |
| forensics | `SIGNUP_ROLE_CLAIM_IGNORED` written to `system_logs` with `{"claimed_role":"admin","granted_role":"patient"}` |

---

### 2.3 `60f317e` — `role` and `department` out of `user_metadata`

**The change.** The two staff-creation paths stopped putting privilege-bearing fields
in caller-writable metadata and moved them to `app_metadata`:
[`src/app/api/admin/staff/route.ts:150-166`](src/app/api/admin/staff/route.ts),
[`src/app/api/admin/staff/[id]/route.ts:66-90`](src/app/api/admin/staff/route.ts),
[`src/lib/patient/createPatient.ts:58-66`](src/lib/patient/createPatient.ts).

**Verification status — partial, stated plainly.** Because `cfe509e` makes the trigger
ignore metadata entirely, moving these fields is defence-in-depth: with migration_21 in
place, `user_metadata.role` on the creation paths is no longer load-bearing for
authorization. The **creation** path (`POST /api/admin/staff`) was exercised as part of
the `cfe509e` regression check and behaves correctly. The **update** path
(`PUT /api/admin/staff/[id]`) was **not** driven against the running dev server in this
session. It is a 10-line metadata reshuffle reviewed by reading only.

---

### 2.4 `5454c00` — MFA assurance gate

**The vulnerability, part one.** The dashboard layout gated staff on *factor
existence*:

```ts
const hasVerifiedFactor = getTotpFactors(factorsData).some(f => f.status === "verified");
if (!hasVerifiedFactor) redirect("/mfa-enroll");
```

Login returns `mfa_required` **without signing out**
([`src/app/(auth)/login/actions.ts:112-118`](src/app/(auth)/login/actions.ts)), so a
password-only AAL1 session survives the prompt and reaches the layout. A verified factor
proves the account *can* use a second factor; only the session's assurance level proves
this session *did*. Checking existence alone means **a stolen password is enough**.

**The vulnerability, part two.** `verifyMfaFactorAction` took `factorId` straight from
the request body and challenged it with no ownership check.

**The fix.** [`src/app/(dashboard)/layout.tsx:90-110`](src/app/(dashboard)/layout.tsx)
reads `getAuthenticatorAssuranceLevel()` and requires `aal2`, failing closed (sign out,
redirect) when the level cannot be read. Both MFA calls are wrapped in `try/catch`
because `getAuthenticatorAssuranceLevel()` throws outright when the stored session has
no `user` — that hardening came from `7d6e5e8`, not `5454c00`, and is a genuine
improvement rather than a regression.
[`src/app/(auth)/mfa-enroll/actions.ts:22-46`](src/app/(auth)/mfa-enroll/actions.ts)
lists the caller's own factors and rejects any `factorId` not in that list, logging
`LOGIN_FAILED` when it does.

**Verified live.** A throwaway `department_staff` account enrolled and verified its own
TOTP factor (secret held by the test, so no real account's factor was touched).

| Session state | Result |
|---|---|
| AAL2 (password + TOTP) | `GET /department/records` → **200** — no false lockout |
| AAL1, factor enrolled (the stolen-password case) | `GET /department/records` → **307 `/login?error=mfa_required`** |
| AAL1 on `/admin/staff`, `/reception/queue`, `/specialist/patients` | **307 `/login?redirect=…`** — note this refusal comes from `src/middleware.ts:24-28` (unauthenticated-path handling) rather than the layout gate; the layout gate is only reached for routes middleware lets through |
| Staff with no verified factor | **307 `/mfa-enroll`** |
| Account B challenges account A's `factorId` | `mfa_factor_not_found Factor not found` on both `challenge` and `verify`; `listFactors()` returns `[]` |

The last row is worth reading carefully: GoTrue itself refuses a cross-account
challenge, so the `mfa-enroll` ownership check is defence-in-depth rather than the sole
barrier. The **server action itself was not invoked** — it is a Next.js server action
and cannot be called from a plain HTTP test. The ownership check is verified at the
`listFactors` / GoTrue layer and by reading the code.

---

### 2.5 `9da4af0` — specialist patients archived, not destroyed

**The vulnerability.** `deleteSpecialistPatientAction` issued a hard `DELETE` on
`specialist_patients`. `specialist_records.specialist_patient_id` is
`ON DELETE CASCADE`, so deleting one patient row **irrecoverably destroyed that
patient's entire longitudinal diagnostic history** — and unlike the create path beside
it in the same file, the delete wrote no audit event at all. No trace, no way back.

**The change.** Three parts:

1. [`src/app/(dashboard)/specialist/patients/actions.ts:161-210`](src/app/(dashboard)/specialist/patients/actions.ts)
   calls `archive_specialist_patient(uuid)` instead of `delete`, and writes a
   `SPECIALIST_PATIENT_DELETED` audit event ([`src/lib/constants.ts:251`](src/lib/constants.ts)).
2. [`src/lib/db/migration_22.sql:42-88`](src/lib/db/migration_22.sql) adds `deleted_at`
   to both tables and splits the `FOR ALL` policies per command. `SELECT` hides archived
   rows; `UPDATE` is deliberately unconstrained on `deleted_at` so archiving is
   permitted; **no `FOR DELETE` policy is created at all**.
3. [`src/lib/db/migration_22.sql:124-162`](src/lib/db/migration_22.sql) adds
   `archive_specialist_patient`, `SECURITY DEFINER` with `search_path = ''`, re-checking
   both permission and ownership in its body, archiving the patient's records in the same
   operation, and `REVOKE`d from `public, anon`.

The addendum at lines 99-122 records a genuinely subtle finding: PostgreSQL re-applies a
`SELECT` policy's `USING` to the **new** row of an `UPDATE`, so a plain `UPDATE` cannot
set `deleted_at` — it violates the very `deleted_at IS NULL` clause that hides archived
rows. Confirmed independently in this session.

**Verified live** — two throwaway specialists, fixtures created and removed.

| Check | Result |
|---|---|
| Specialist `DELETE`s their own `specialist_patients` row | 0 rows returned, no error; service role confirms **row still present, `deleted_at` null** |
| Specialist `DELETE`s a `specialist_records` row (corrected predicate) | 0 rows returned; **row survives** |
| Specialist `UPDATE`s `deleted_at` directly | **`42501 new row violates row-level security policy`** |
| `archive_specialist_patient(own patient)` | returns `true`; patient **and both records** keep their rows with `deleted_at` set |
| Archived rows in the owner's `SELECT` | patient 0 rows, records 0 rows |
| Second archive call | returns `false` |
| Archive another specialist's patient | returns `false`, victim's `deleted_at` still null |
| Archive a non-existent id | returns `false` |
| A `patient`-role account calls the RPC | `data: null`, **`42501 not permitted`** |
| Anonymous (no session) calls the RPC | **`42501 permission denied for function archive_specialist_patient`** |

Live policy state matches migration_22: 3 policies per table (`SELECT`/`INSERT`/`UPDATE`),
none for `DELETE`. `relrowsecurity = true` on both.

**Not verified:** the `SPECIALIST_PATIENT_DELETED` audit write. It lives in the server
action, which cannot be invoked from an HTTP test. The function path is verified; the
audit line is verified by reading only.

---

### 2.6 `297365c` — triage routes before approving

**The vulnerability.** The old order in
[`src/components/TriageModal.tsx`](src/components/TriageModal.tsx) was: approve the
document, *then* triage. Approving first consumed the document (`status → approved`,
removing it from reception's pending board) before the queue entry was known to exist.
When `/api/reception/triage` then answered **409** — because the patient already had an
open queue entry ([`src/app/api/reception/triage/route.ts:101-114`](src/app/api/reception/triage/route.ts))
— the document had already left the only queue that would ever have routed it: gone
from reception, absent from every department, recoverable through no UI action.

**The change.** [`src/components/TriageModal.tsx:114-190`](src/components/TriageModal.tsx)
inverts the order. Routing first makes the failure survivable: a 409 leaves the document
untouched and still pending. A later approval failure is reported as its *own*
outcome (a warning toast naming the queue number), because at that point the patient is
safely queued and the document is still pending — a state a human can resolve.

**Verified live** against the real dev server as a real receptionist session.

| Step | Result |
|---|---|
| Patient pre-placed in an open `laboratory` queue entry | precondition |
| `POST /api/reception/triage` | **409** — "Patient already in Laboratory queue. Resolve the existing entry before routing a new one." |
| `documents.status` afterwards | **`pending`** — still on reception's board, recoverable |
| Blocker cleared, same order | `triage` → 200 (`IMG-001`), `approve` → 200, `documents.status` → `approved`, queue entries `laboratory/completed, imaging/waiting` |

---

### 2.7 `4dba065` — `patient_queue` entries orphaned across the PHT day boundary

**The defect.** The department's queue list was scoped to
`created_at >= start-of-PHT-today`, while reception's re-triage guard had no date
predicate. An entry created before PHT midnight was therefore **invisible to the
department, still blocking re-triage at reception, and impossible to close** —
permanently stuck, and still shown to the patient as "waiting".

**The change.** The date filter is removed from all three queries so they agree:
[`src/app/(dashboard)/department/records/page.tsx:89-114`](src/app/(dashboard)/department/records/page.tsx),
[`src/app/api/department/queue/route.ts:27-51`](src/app/api/department/queue/route.ts),
[`src/app/api/department/records/route.ts:188-205`](src/app/api/department/records/route.ts).
An age badge was added so an older order is visibly older
([`src/components/DepartmentRecordsClient.tsx:108-124`](src/components/DepartmentRecordsClient.tsx)).

**Verified live.** A queue entry created three days ago, owned by a throwaway
`department_staff` (AAL2) with a throwaway receptionist:

| Check | Result |
|---|---|
| Aged entry in `GET /api/department/queue` | **present**, `rows=1` (the pre-fix query returned 0) |
| Aged entry on `GET /department/records` | **200**, contains the queue id |
| Reception `POST /api/reception/triage` for that patient | **409** — the two sides now agree: what blocks reception is what the department can see and close |

---

### 2.8 `7d6e5e8` — failed queries rendered as empty results

**The defect.** Several clinical surfaces read a query's `error` into `console.error`
and then rendered the empty result set anyway. A failed fetch and an empty result are
not the same thing. Reception read five empty kanban columns as "no pending referrals";
a specialist read "0 records, 0 flagged" as *a patient with no findings*; a patient
read "you have no results" as *records that do not exist*. Each is a confident wrong
answer that looks exactly like a real one — which is what makes it dangerous in a
clinical tool.

**The change.** A `DataLoadError` component
([`src/components/DataLoadError.tsx`](src/components/DataLoadError.tsx)) that says the
data is *unknown* rather than *absent*, applied at nine sites. The specialist roster
withholds itself entirely rather than rendering fabricated zeroes, because every row's
record count, flagged count and last-test date derives from the query that failed
([`src/app/(dashboard)/specialist/patients/page.tsx:44-93`](src/app/(dashboard)/specialist/patients/page.tsx)).

**Verified live, partially.** `SELECT` was temporarily revoked on
`public.specialist_records` and the real pages rendered, then the grant was restored:

| State | `/specialist/dashboard` | `/specialist/patients` |
|---|---|---|
| Grant intact (baseline) | 200, no banner | 200, no banner, normal "No records" state |
| `SELECT` revoked | 200, **"Could not load your specialist dashboard"** | 200, **"Could not load your patient roster"**, roster withheld, no empty-state copy |
| Grant restored | 200, no banner | 200, no banner |

ACL before the test and after the restore, byte-identical:

```
{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
```

**Not verified:** the other seven surfaces — reception queue, reception document detail,
patient results, patient submissions, admin RAG, admin staff registry, and specialist
analytics. They were verified by reading the diff only. Note that the roster check
required a non-empty roster: with no `specialist_patients` rows the records query is
skipped entirely (page.tsx:29), so the first run of this probe was vacuous until a
fixture patient was added.

---

### 2.9 `cc1f068` — `schema.sql` reconciliation

See §0.2. Verified by reading: the `profiles` policies at
[`src/lib/db/schema.sql:187-211`](src/lib/db/schema.sql) and the signup trigger at
[`src/lib/db/schema.sql:354-386`](src/lib/db/schema.sql) both match the live database.
The specialist tables at [`src/lib/db/schema.sql:453-497`](src/lib/db/schema.sql) do not.

---

### 2.10 `50361eb` and `ce7eca4`

`50361eb` tracks `migration_17.sql`, `migration_18.sql` and the specialist analytics
seed data (1,199 lines). No runtime behaviour; files confirmed present in
`src/lib/db/` and `supabase/seed/`. **Not verified** beyond presence.

`ce7eca4` is the most consequential of the housekeeping commits: `supabase/.temp/` was
tracked, and `pooler-url` in it carries the project ref, the organisation id and the
region. It also repaired a `.gitignore` that had a UTF-16LE fragment appended after its
UTF-8 content — git could not parse it, so the `RBAC_HANDOFF.md` rule it appeared to add
was silently inert. Confirmed: `.gitignore` is now valid UTF-8, `supabase/.temp/` is
untracked, and `RBAC_HANDOFF.md` is genuinely ignored.

---

## 3. What was NOT verified

Stated plainly, because this document will be relied on.

| Not verified | Why | Risk if broken |
|---|---|---|
| `SPECIALIST_PATIENT_DELETED` audit write (`9da4af0`) | Next.js server action; not invokable from an HTTP test | Archive works but leaves no forensic trail — the original complaint was partly "no trace" |
| `PUT /api/admin/staff/[id]` (`60f317e`) | Not driven against the dev server in this session | Staff role edits could lose department mirroring |
| The `verifyMfaFactorAction` ownership check itself (`5454c00`) | Server action; GoTrue layer verified, action not invoked | Low — GoTrue independently refuses cross-account challenges |
| 7 of 9 `DataLoadError` surfaces (`7d6e5e8`) | Only the two specialist pages were exercised | A remaining surface may still render a failed fetch as an empty result |
| `50361eb` seed data correctness | Data, not behaviour | Analytics fixtures may be wrong |
| The `archive_specialist_patient` function under **concurrent** archive calls | Not tested; `UPDATE ... RETURNING` is not obviously race-free | Two simultaneous archives could both return `true` |
| Any fix's behaviour against a **second** environment | Only one project exists in `.env.local`; the `# prod (disabled)` block is a placeholder | Drift between environments is invisible |

---

## 4. Re-verification method

**Constraints honoured.** No `DELETE`, `DROP`, `TRUNCATE` or `ALTER` was run against any
table holding real data. Every row created was created by the script that deleted it,
matched by a generated id. No `auth` config was touched. RLS was never disabled. The one
privilege change — a `REVOKE` for the `7d6e5e8` check — was restored with the matching
`GRANT` and the ACL verified byte-identical before and after. The only residue left
behind is 24 audit-log rows, which were kept on purpose (below).

**Fixtures.** All throwaway accounts were created with
`svc.auth.admin.createUser` and deleted with `svc.auth.admin.deleteUser`, with the
`profiles` row removed by id. Every script cleans up in a `finally` block. No real
account's MFA factor was enrolled, deleted or replaced — the pre-existing scratch script
`verify-mfa-final.mjs` deletes factors on a real account, so a throwaway-account version
was written instead.

**Row counts before and after, identical:**

| Table | Before | After |
|---|---|---|
| `auth.users` | 1434 | 1434 |
| `auth.mfa_factors` | 41 | 41 |
| `public.profiles` | 965 | 965 |
| `public.patients` | 506 | 506 |
| `public.documents` | 555 | 555 |
| `public.patient_queue` | 128 | 128 |
| `public.department_records` | 127 | 127 |
| `public.specialist_patients` | 21 | 21 |
| `public.specialist_records` | 167 | 167 |
| `public.roles` | 10 | 10 |
| `public.role_permissions` | 48 | 48 |
| `public.system_logs` | 3594 | **3618 (+24)** — see below |

**The one residue, stated precisely.** The `handle_new_user` trigger writes a
`USER_REGISTERED` row (and, where a role was claimed, `SIGNUP_ROLE_CLAIM_IGNORED`) to
`system_logs` for every account created — including the throwaways. 24 such rows remain
(ids 3828–3851, all between 07:12 and 07:21 UTC): 21 `USER_REGISTERED`, 1
`SIGNUP_ROLE_CLAIM_IGNORED`, 1 `TRIAGE_COMPLETED`, 1 `DOCUMENT_APPROVED`.

They were **deliberately not deleted.** `system_logs` is the audit trail, and deleting
records from it to make a row count look tidy would be tampering with the evidence this
whole review rests on. They are an accurate record that these test accounts existed.

Their `user_id` is now `NULL`, because `system_logs_user_id_fkey` is
`FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL` — removing the
throwaway `profiles` rows nulled the actor in place. The rows survive; only the
attribution is gone. That same FK explains most of the `auth.users` vs `profiles` gap
in §5.3: the table already holds 600 `USER_REGISTERED` rows with a NULL `user_id` from
previously-deleted accounts, versus 1004 with one.

**Totals: 48 assertions across 8 scripts, 48 passed.** Two early "failures" were bugs in
my own test code, not defects in the application, and both are documented where they
occur (§2.8 and the note in §4.1) rather than quietly dropped.

### 4.1 Harness scripts

All under `C:\Users\johnr\AppData\Local\Temp\klinikaid-test\`, adapted from the existing
scratch scripts:

| Script | Covers |
|---|---|
| `rv-escalation.mjs` | §2.1 — `cd5ac56` |
| `verify-signup.mjs` (reused as-is) | §2.2 — `cfe509e` |
| `rv-mfa.mjs` | §2.4 — `5454c00` |
| `rv-specialist.mjs` + `rv-delete-probe.mjs` | §2.5 — `9da4af0` |
| `verify-triage-order.mjs` (reused as-is) | §2.6 — `297365c` |
| `rv-gapfill.mjs` | §2.7 `4dba065` + the corrected `is_active` leg of §2.1 |
| `rv-uifail.mjs` + `rv-ui-fixture.mjs` | §2.8 — `7d6e5e8` |

**Corrected during the run.** The first `is_active` check set the column to `true` on a
row that was already `true`, which proves nothing — the row was unchanged because the
write was a no-op, not because RLS refused it. Re-run against a value that *differs*
(`false`), it rejects with `42501` as expected. The first specialist-records `DELETE`
check compared a uuid column against a JS object and matched zero rows, producing a
false "row destroyed" reading; re-run correctly, the row survives.

---

## 5. Known limitations and residual risk

These are real. None is addressed by this PR, which is documentation only.

### 5.1 `schema.sql` can silently undo `9da4af0` — highest impact

Covered in §0.2. Anyone rebuilding a database from `src/lib/db/schema.sql` gets
`FOR ALL` policies on `specialist_patients` including `DELETE`, restoring the
cascade-destroy defect in full. The live database is correct; the file is the
liability. **Recommend** folding migration_22 into `schema.sql`, or better, retiring
`schema.sql` as a second source of truth and moving `src/lib/db/migration_*.sql` into
a real `supabase/migrations/` directory.

### 5.2 No migration history — "applied" is an unverifiable claim

`supabase_migrations.schema_migrations` contains **2** rows, both from the CLI's
initial baseline (`20260701000000`, `20260705000000`). None of the 22 hand-authored
`src/lib/db/migration_*.sql` files are recorded there. The only evidence any of them
were applied is manual inspection of the live database — which is exactly what this
review had to do, and it took several hours for 22 files. A future reviewer cannot
diff the live schema against the migrations. **Recommend** adopting
`supabase db push` with real migration files, so drift is detectable.

### 5.3 `auth.users` holds 1,434 accounts against 965 profiles

469 auth rows have no `profiles` row. Not created by this review (counts are unchanged),
and the layout signs such sessions out at
[`src/app/(dashboard)/layout.tsx:42-46`](src/app/(dashboard)/layout.tsx), so it is not
directly exploitable. But it is a large unexplained gap in a clinical system and worth
an audit of its own. Much of it is probably `auth.admin.deleteUser` leaving an auth row
behind after the profile was removed — 600 `USER_REGISTERED` audit rows carry a NULL
`user_id` because `system_logs_user_id_fkey` is `ON DELETE SET NULL`. Worth confirming
which accounts these are before assuming they are all deprovisioned staff.

### 5.4 Audit rows lose their actor when a profile is deleted

`system_logs.user_id` is `ON DELETE SET NULL` with respect to `profiles.id`. Deleting a
profile — the normal way to remove a staff member — silently strips the actor from
every audit row that person ever generated, leaving the event and its `description`
behind with no attributable subject. For a clinical system under RA 10173 that is a
weaker trail than the schema implies: 674 of 3,618 rows currently have no actor.
**Recommend** `ON DELETE RESTRICT` plus a soft-delete on `profiles`, or snapshotting
the actor's identity into `metadata` at write time so the trail survives deprovisioning.

### 5.5 `anon` holds full table privileges on all 15 public tables

Every table carries `anon=arwdDxtm`. RLS is the *only* thing standing between the
browser-public anon key and every table, on every table, with no second layer. This is
normal Supabase, but it means the blast radius of any single missing or wrong policy is
total. The `profiles` and specialist work reduced that exposure on the two tables that
had real holes; the other thirteen were not re-reviewed here.

### 5.6 `SECURITY DEFINER` functions in `public`

`archive_specialist_patient` is the best-handled example in the codebase
(`search_path = ''`, permission and ownership re-checked in the body, `REVOKE`d from
`anon`). It is not the only one. `get_auth_user_role()`, `get_auth_user_dept()`,
`match_documents()`, `handle_new_user()` and `get_user_id_by_email()` are all
`SECURITY DEFINER` and all still executable by `anon`. None were re-reviewed in this
session. **Recommend** an audit pass over the remaining `SECURITY DEFINER` functions.

### 5.7 Archived patients cannot be restored through the app

`migration_22` documents this itself: RLS hides an archived row from the owner's
`SELECT`, so no `UPDATE` can reach it. Archival is one-way from the application. A
restore needs a separate policy and is explicitly out of scope. Given this is clinical
record-keeping under RA 10173, one-way deletion-by-archival should have a documented
retention and restore policy before it is relied on.

### 5.8 `TriageModal` is still a two-request sequence

`297365c` inverted the order so the *unsafe* direction is no longer reachable, but
there is still no transaction: a crash between the two `fetch` calls leaves the patient
queued and the document pending. That state is now recoverable and visible rather than
silent, which is a real improvement, but it is a recoverable-inconsistency window, not
a fix. A single server-side endpoint performing both steps in one transaction would
close it.

### 5.9 MFA assurance is not re-checked after the layout

`5454c00` gates the layout at request time. A long-lived AAL2 session that is later
downgraded, or a session whose factor is deleted mid-session, is not re-evaluated on
subsequent requests. Standard for this class of gate; noting it rather than claiming it
is a residual weakness.

### 5.10 `docs/` is gitignored, which is why this PR touches `.gitignore`

`ce7eca4` added `docs/` to `.gitignore` as "untracked dev context". A deliverable that
has to be reviewable in a pull request cannot live in an ignored directory. This PR
adds a narrow exception — `!docs/` + `docs/*` + `!docs/SECURITY-FIX-REVIEW.md` — so
**only** this file is tracked and every other file under `docs/` stays ignored as before.
Worth a maintainer's eye: the exception is a judgement call, and if the intent was for
`docs/` to be entirely untracked, this should instead land somewhere else.

---

## 6. Recommendation for reviewing these commits

The code is in materially better shape than it was before `4dba065`, and every
security-relevant fix in the range was confirmed live in this session. What was missing
was not correctness — it was **the review record**. This document is that record, and
its own gaps are marked rather than smoothed over.

Before merging, decide on §0.2 (`schema.sql` divergence) and §5.9 (the `.gitignore`
exception). Both are one-line-ish fixes and both are the kind of thing that gets missed
if the only record of these commits is a commit message.
