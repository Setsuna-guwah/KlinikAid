# Database & Schema Reference
*Details of schemas, triggers, Row-Level Security, migrations, and RPC functions in KlinikAid*

This document serves as the authoritative schema guide for the KlinikAid Supabase PostgreSQL database.

---

## Database Setup

For a **fresh Supabase project**, run `src/lib/db/schema.sql` **once** in the
Supabase SQL editor, or with a direct database connection:

```bash
psql "$FRESH_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f src/lib/db/schema.sql
```

Use a database administrator connection with permission to create the app's auth
triggers and storage policies. Supabase must already supply its `auth`, `storage`,
`extensions` schemas and platform roles; this is not a standalone Postgres installer.
The snapshot includes the current state **through migration_41**, system role and
permission reference data, a private `patient-documents` bucket, auth triggers,
Realtime membership, and migration coverage records. It contains no application data.
It runs in a transaction and refuses an existing public table before changing anything.
A second run therefore fails cleanly; it does not erase or replace an existing database.

For **existing databases**, apply only `migration_N.sql` files newer than your
recorded `supabase_migrations.schema_migrations` history, in numeric order, and
record each successful application. Never replay the snapshot or historical files
already represented in that history. The `applied/` files are recovered historical
records, not additional fresh-project setup steps. Legacy databases without reliable
history need their actual schema checked before choosing a migration starting point.
The snapshot assigns coverage markers `20261017000007`–`20261017000026` to previously
untracked migrations 07–26, retains the two July versions from `applied/`, and uses
`20261017000027`–`20261017000029` and `20261018000030`–`20261018000036` for 27–36,
`20261020000037` for 37, `20261021000038` for 38, `20261022000039` for 39, `20261023000040` for 40, and `20261023000041` for 41.
Those markers describe snapshot coverage, not individual historical executions.

### Regenerating the snapshot

Regenerate `schema.sql` after **every migration**, from a verified current database.
Use PostgreSQL 17 `pg_dump` (17.11 was used for this snapshot), keeping grants:

```bash
pg_dump "$SOURCE_DATABASE_URL" --schema-only --schema=public --no-owner > public.sql
```

1. Keep the header, transaction and empty-schema guard. Enable `vector` in `public`,
   and `pgcrypto` and `uuid-ossp` in `extensions`, before the dumped DDL.
2. Insert the dumped public DDL and ACLs. Remove `CREATE SCHEMA public`, owner
   statements, psql `\restrict`/`\unrestrict` commands (for SQL-editor compatibility),
   and Supabase-managed `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` statements
   that a project administrator cannot change. Preserve the `postgres` defaults and
   all explicit object grants/revocations. Before restoring ACLs, revoke the default
   `anon`, `authenticated` and `service_role` object grants on all public tables,
   sequences and functions: Supabase defaults can otherwise retain privileges absent
   from the source dump. Preserve the default `PUBLIC` function execution unless the
   captured ACL explicitly revokes it. Keep `check_function_bodies = false` so
   dump ordering can define functions before their referenced tables.
3. Export only system roles (`is_system = true`), the permission catalog, and mappings
   for those system roles. Render inserts by name with generated IDs/default timestamps;
   never include custom roles, user IDs, profiles, patients, counters or other row data.
4. Public-only dumps omit app objects in platform schemas. Capture the private bucket's
   configuration, its four `storage.objects` policies, the two app triggers on
   `auth.users`, and membership of `supabase_realtime` (`documents`, `patient_queue`).
   Include those after the reference data; do not copy platform-owned tables/functions.
5. Update the migration coverage rows and header, then `COMMIT`. On a disposable local
   Supabase stack, bootstrap with `ON_ERROR_STOP`, verify the second-run refusal,
   compare a normalized public dump (including ACLs), check external objects and system
   reference mappings, and smoke-test signup, profile RLS and permission RPCs.
   Review the final SQL for personal data before committing it.

The snapshot is generated from database state; migration files remain historical
records and must not be deleted. Credentials and intermediate data exports stay local.

---

## Database Tables

KlinikAid uses 8 primary tables to manage application state:

### 1. `profiles`
- **Purpose**: Extends Supabase auth.users with application-specific roles and metadata. Created automatically by database triggers on auth signup.
- **Key Columns**:
  - `id` (uuid, PK, FK `auth.users.id` ON DELETE CASCADE)
  - `full_name` (text, NOT NULL)
  - `role` (text, NOT NULL, CHECK: `'admin' | 'receptionist' | 'department_staff' | 'medical_specialist' | 'patient'`)
  - `department` (text, CHECK: `'laboratory' | 'imaging' | 'ultrasound' | 'ecg'`)
  - `is_active` (boolean, default true, NOT NULL)
  - `accepted_privacy_at` (timestamp with time zone, nullable)
- **RLS Summary**:
  - Admins: Full access.
  - Staff & Specialists: Select access to all profiles.
  - Owners (auth.uid() = id): Select own profile, and Update own profile (role change is blocked during update).

### 2. `patients`
- **Purpose**: Stores clinical profiles of patients. Every patient user has a `profiles` row (role `'patient'`) linked to a `patients` row.
- **Key Columns**:
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `profile_id` (uuid, FK `profiles.id` ON DELETE SET NULL)
  - `first_name`, `last_name` (text, NOT NULL)
  - `date_of_birth` (date, NOT NULL)
  - `gender` (text, CHECK: `'male' | 'female' | 'other'`)
  - `contact_number`, `address` (text, NOT NULL)
  - `email` (text, nullable)
- **Indexes**: `patients_profile_id_key` on `(profile_id)` (migration 39) — one patient row per profile. Without it, two rows could be inserted for the same profile (the mobile app's `create-patient-record` Edge function can be raced into one), and the single-row read the app uses to load a patient's own record then fails. NULLs are distinct in a unique index, so rows without a profile are unaffected and `ON DELETE SET NULL` keeps working.
- **RLS Summary**:
  - Admins: Full access.
  - Receptionists: Full access.
  - Department Staff & Specialists: Select access.
  - Owners (`profile_id = auth.uid()`): Select own record, and Update own details.

### 3. `patient_queue`
- **Purpose**: Manages active clinical department waitlists and triage records.
- **Key Columns**:
  - `id` (bigint, PK, identity)
  - `patient_id` (uuid, FK `patients.id` ON DELETE CASCADE, NOT NULL)
  - `status` (text, default `'waiting'`, CHECK: `'waiting' | 'in_progress' | 'completed' | 'cancelled'`)
  - `department` (text, CHECK: `'laboratory' | 'imaging' | 'ultrasound' | 'ecg'`)
  - `triage_notes` (text) — **CRITICAL**: Stored as a JSON string containing queue details and vitals (e.g. `{"queue_number": "L-001", "vitals": {"blood_pressure": "120/80", "weight_kg": 70, "temperature_c": 36.5}}`).
  - `priority_level` (text, default `'routine'`, CHECK: `'routine' | 'urgent' | 'emergency'`)
  - `estimated_wait_minutes` (integer)
- **RLS Summary**:
  - Admins: Full access.
  - Receptionists: Full access.
  - Department Staff: Full access but locked to their own profile department (`department = public.get_auth_user_dept()`).
  - Specialists: Select access.
  - Patients: Select own queue entries.

### 4. `documents`
- **Purpose**: Tracks patient diagnostic uploads requiring front-desk review and validation.
- **Key Columns**:
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `patient_id` (uuid, FK `patients.id` ON DELETE CASCADE)
  - `uploader_id` (uuid, FK `profiles.id` ON DELETE SET NULL, NOT NULL)
  - `file_name` (text, NOT NULL)
  - `file_path` (text, NOT NULL) — Holds the object key inside the storage bucket.
  - `file_type` (text, NOT NULL)
  - `status` (text, default `'pending'`, CHECK: `'pending' | 'approved' | 'rejected'`)
  - `ocr_text` (text, nullable)
  - `extracted_metadata` (jsonb, nullable)
  - `rejection_reason` (text, nullable)
- **RLS Summary**:
  - Admins & Receptionists: Full access.
  - Patients: Select own documents, Insert own documents, and Update own documents (only if status is `'pending'`).

### 5. `department_records`
- **Purpose**: Stores clinical values and results recorded by department personnel. Follows a flat relational structure (one row per parameter per visit).
- **Key Columns**:
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `patient_id` (uuid, FK `patients.id` ON DELETE CASCADE, NOT NULL)
  - `recorder_id` (uuid, FK `profiles.id` ON DELETE SET NULL, NOT NULL)
  - `department` (text, CHECK: `'laboratory' | 'imaging' | 'ultrasound' | 'ecg'`)
  - `test_type` (text, NOT NULL)
  - `test_name` (text, NOT NULL)
  - `test_value` (text, NOT NULL)
  - `unit` (text)
  - `reference_range_min`, `reference_range_max` (numeric)
  - `is_flagged` (boolean, default false, NOT NULL) — Flagged if `test_value` falls out of normal ranges.
- **RLS Summary**:
  - Admins: Full access.
  - Department Staff: Full access limited strictly to their own department (`department = public.get_auth_user_dept()`).
  - Specialists: Select access to all records.
  - Patients: Select access to own records.

### 6. `system_logs`
- **Purpose**: Audit trail documenting administrative actions, security failures, and portal updates.
- **Key Columns**:
  - `id` (bigint, PK, identity)
  - `user_id` (uuid, FK `profiles.id` ON DELETE SET NULL, nullable)
  - `event_type` (text, NOT NULL) — Maps to `SYSTEM_EVENT_TYPES` keys.
  - `description` (text, NOT NULL)
  - `ip_address` (text, nullable)
  - `metadata` (jsonb, nullable)
- **Indexes**: `idx_system_logs_created_at_desc` on `(created_at DESC)` (migration 38) — the newest-rows-first reads the dashboard and the log view make. Without it, `ORDER BY created_at DESC LIMIT n` had to walk every row and put each of them through the read policy.
- **RLS Summary**:
  - Admins: Select access.
  - Authenticated Users: Insert access.

### 7. `chatbot_logs`
- **Purpose**: Tracks patient queries, AI responses, and token counts.
- **Key Columns**:
  - `id` (bigint, PK, identity)
  - `user_id` (uuid, FK `profiles.id` ON DELETE CASCADE, nullable)
  - `session_id` (text, NOT NULL)
  - `user_message` (text, NOT NULL)
  - `bot_response` (text, NOT NULL)
  - `tokens_used` (integer, default 0, NOT NULL)
- **RLS Summary**:
  - Admins: Select access.
  - Owners (`user_id = auth.uid()`): Full access.

### Permission catalogue indexes

`public.user_has_permission()` is called once per row by every RLS policy that
filters on a permission, so its own lookup is on the hot path of every
read. Both halves of that lookup are already index scans: `permissions (name)`
through the unique constraint `permissions_name_key`, and
`role_permissions (role_id, permission_id)` through its primary key, so
migration 38 adds no index for it.

### 8. `rag_documents`
- **Purpose**: Stores RAG knowledge chunks for grounding the AI assistant.
- **Key Columns**:
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `title` (text, NOT NULL)
  - `content` (text, NOT NULL)
  - `embedding` (vector(768), NOT NULL) — 768-dimensional float array.
  - `metadata` (jsonb, nullable)
- **RLS Summary**:
  - Admins: Full access.
  - Public: Select access.

---

## Migration History

Historical migrations are retained under `src/lib/db/` through migration 42.
Migration 39 (one patient row per profile) was applied to production on
2026-10-22. Migration 40 (lab plausibility guard) and migration 41 (patient
template submission) and migration 42 (patient upload submission) were applied
on 2026-10-23. All four are in the
`schema.sql` snapshot.

The following are early milestones, not a fresh-project execution sequence:

1. **`migration_07.sql`** (pgvector Search)
   - Created the `match_documents` similarity search RPC.
2. **`migration_08.sql`** (Token Management & Indexing)
   - Created the `get_daily_token_usage` RPC and added the index `idx_chatbot_logs_session_id`.
3. **`migration_09.sql`** (Storage Bucket)
   - Created the private `patient-documents` bucket and added storage policies.
4. **`migration_10.sql`** (Data Privacy Gate)
   - Added the `accepted_privacy_at` consent timestamp to `public.profiles`.

### Migration 40 — lab plausibility guard (applied 2026-10-23)

`src/lib/db/migration_40.sql` moves the lab plausibility rule out of client
code, where it lived only in `src/lib/constants.ts` (`plausibleMin` /
`plausibleMax`, enforced by `src/lib/records/validateLabResult.ts`). Web
enforced it in the two places it writes lab results, but the mobile app inserts
into `department_records` and `specialist_records` straight through PostgREST
under the user's own JWT, so web's check never saw those writes (#204).

What the file adds:

- **`public.lab_plausibility_limits(test_name, plausible_min, plausible_max, unit)`**
  — the six numeric lab parameters, seeded from `LAB_REFERENCE_RANGES` with an
  upsert, so a re-run restores what `constants.ts` declares. RLS is enabled:
  `authenticated` has a SELECT policy and the SELECT grant (clients may read
  the limits), `anon` and `authenticated` hold no write privilege and there is
  no write policy, so no client can widen a bound.
- **`public.enforce_lab_plausibility()`**, a `BEFORE INSERT OR UPDATE` trigger
  on `department_records` and `specialist_records`. It is `SECURITY DEFINER`
  with `search_path = ''`, so it reads the limits itself instead of through the
  caller's RLS: RLS removes rows rather than raising, so under
  `SECURITY INVOKER` a writer that could not read the limits would be checked
  against nothing and pass.
- The check runs only where `test_name` matches a limited parameter byte for
  byte — the validator's own matching, no case folding and no trimming — and,
  for `department_records`, only where `department = 'laboratory'`. Narrative
  rows (`Findings`, `Impression`), the free-text names the other departments
  record, and every other name are left alone, and a stored `test_value` is
  never rewritten.

**Error shape clients will see.** A refused write is SQLSTATE `23514`
(`check_violation`) carrying web's own refusal sentence, e.g.

```
Fasting Blood Sugar (FBS): -5 mg/dL is outside the possible range (5–3000 mg/dL). Check the value and its unit.
Fasting Blood Sugar (FBS): "5." is not a valid number. Enter digits with an optional decimal point, e.g. 95 or 13.2.
```

PostgREST maps `23514` to **HTTP 400** with the body
`{"code":"23514","message":"<that sentence>","details":null,"hint":null}`,
so through supabase-js it is `error.code === "23514"` with the sentence in
`error.message`. The statement aborts as a whole, so a batch that contains one
implausible value writes none of its rows.

- **Mobile** writes directly, so that is the shape it should show.
- **Web's own lab paths validate before they insert** and so never reach the
  trigger: `POST /api/department/records` answers **400** with the same sentence
  (`ValidationError` through `handleRouteError`), and the specialist record
  action returns `{ success: false, error: "<same sentence>" }`. If a write did
  reach the trigger through the department route, that route's catch-all would
  report its usual **500** `"Failed to save department records"`, with the
  refusal sentence only in `debug_details` in development.
- **The pre-flight query** in the file's header counts the rows the rule would
  refuse and must return zero before anything is applied. The migration repeats
  that count inside its own transaction and raises rather than applying if it
  does not; it never deletes or updates a row to make itself fit.

Migration 40 was applied to production on 2026-10-23 and is in the `schema.sql`
snapshot. `src/lib/db/migration40LabLimits.test.ts` checks that the limits seeded
in the migration still equal `constants.ts`; if a bound in `constants.ts` changes,
the database row needs a new migration too.

### Migration 41 — patient template submission (applied 2026-10-23)

`src/lib/db/migration_41.sql` gives patient form templates one server
operation shared by web and mobile (Stage 1 of the patient submission
contract, JudgementKazzy2023/Klinikaid-Mobile-App#36). Patients hold no INSERT
policy on `documents` (migration_23), so mobile has no other route.

What the file adds when it is applied:

- **`public.submission_receipts`** — one row per accepted request, keyed
  `(user_id, operation, request_id)`, with the request fingerprint and
  `document_id`. A receipt can be replayed for 30 days (`expires_at`) and is
  then kept indefinitely as audit evidence; nothing deletes receipts, which is
  what makes "no receipt" a definite answer. Any future retention needs its
  own migration with tombstones. `document_id` is set to null when the
  patient cancels the document. RLS on with no policies: only `service_role`
  reads or inserts.
- **`public.submit_patient_template(...)`** — `service_role` only. In one
  transaction it checks the receipt, applies the duplicate rule (one pending
  document per patient and category: `template_id` for templates,
  `extracted_metadata.document_type` for uploads, `other` exempt), and inserts
  the document, the attributed `DOCUMENT_SUBMITTED` row in `system_logs` and
  the receipt. Any failure rolls back all of it.

Outcomes, returned as `jsonb` rather than raised:

| `outcome` | Meaning |
|---|---|
| `created` | New document; `document_id` returned |
| `replayed` | Same request id and content; the original `document_id`, nothing inserted |
| `conflict` | Same request id, different content |
| `expired` | Receipt past `expires_at`; reconciliation, never a fresh insert |
| `withdrawn` | The patient cancelled that document |
| `duplicate` | A pending document of that category exists; its `document_id` and `status` |

- **`public.submit_patient_template_outcome(user_id, request_id)`** —
  `service_role` only, writes nothing. The owner-scoped outcome lookup behind
  `POST /functions/v1/patient-document-submission/status`: what happened to a
  request, without resending it. It takes the same per-request advisory lock as
  the submit, so a lookup during an in-flight submit waits for it to finish.

| `state` | Meaning |
|---|---|
| `committed` | The request created `document_id`; `status` is its **current** status, `replayable` is false at or after `expires_at` |
| `withdrawn` | It committed, then the patient cancelled the document |
| `not_found` | No receipt for this caller: the request never committed (another user's id is also `not_found`) |

**Ordering:** apply before deploying the `patient-document-submission` Edge
function or the web deploy whose `patient/templates` action calls it. Nothing
calls the function before then, so applying it alone changes no behaviour.
Applied to production on 2026-10-23, before #215 merged and the function was
deployed; `schema.sql` includes it.

**Legacy duplicate report.** Rows written before migration 41 may already have
more than one pending document per category; the rule applies only to new
submissions and never changes existing rows. Before template submission is
re-enabled on mobile, run `src/lib/db/reports/pending_document_duplicates.sql`.
It is read-only (each part runs in a `READ ONLY` transaction) and uses the
migration's own category rule, in three parts: a summary per category, the
patient/category conflicts with their document ids, and rows whose category is
unknown or silently `other`. Parts 2 and 3 list ids; keep their results
private. `src/lib/db/reports/pendingDocumentDuplicates.test.ts` keeps its known
categories equal to `CLINIC_TEMPLATES` plus `other`.

---

## RPCs and Trigger Functions

### `public.handle_new_user()`
- **Type**: `TRIGGER` (AFTER INSERT on `auth.users`)
- **Behavior**:
  1. Extracts metadata (`full_name`, `role`, `department`) provided during signup.
  2. Ensures the role defaults to `'patient'` if invalid.
  3. Enforces department constraints (null unless role is `'department_staff'`).
  4. Inserts a matching row into `public.profiles`.
  5. Inserts an audit log entry (`USER_REGISTERED`) into `public.system_logs`.

### `public.match_documents(query_embedding vector(768), match_threshold float, match_count int)`
- **Type**: `RPC`
- **Returns**: `TABLE (id, title, content, metadata, similarity)`
- **Behavior**: Scans `rag_documents` table using cosine distance (`<=>`) to return context chunks matching similarity $\ge$ `match_threshold`.

### `public.get_daily_token_usage(start_date timestamptz)`
- **Type**: `RPC`
- **Returns**: `TABLE (date, total_tokens, query_count)`
- **Behavior**: Sums total tokens used by chatbot in Asia/Manila (UTC+8) terms since `start_date`.

### `public.get_auth_user_role()` / `public.get_auth_user_dept()`
- **Type**: `HELPER`
- **Behavior**: Retrieves role and department of `auth.uid()` securely on the database side to resolve RLS checks without recursion.

---

## Important Enumerated Values

Devs must use these exact values to prevent database inserts from failing the constraints:

- **Clinicial Departments**: `'laboratory'`, `'imaging'`, `'ultrasound'`, `'ecg'` (never use `'xray'`).
- **User Roles**: `'admin'`, `'receptionist'`, `'department_staff'`, `'medical_specialist'`, `'patient'`.
- **Priority Levels**: `'routine'`, `'urgent'`, `'emergency'`.
- **Queue Status**: `'waiting'`, `'in_progress'`, `'completed'`, `'cancelled'`.
- **Document Status**: `'pending'`, `'approved'`, `'rejected'`.

### Migration 42 — patient upload submission (applied 2026-10-23)

`src/lib/db/migration_42.sql` extends migration 41's retained receipts to
`submit_upload`. `submit_patient_upload(...)` and `submit_patient_upload_outcome`
are SECURITY INVOKER, empty search_path, and executable only by service_role.
Web confirmation and the Edge Function upload routes share these operations.

The transaction checks replay/conflict/expiry/withdrawal, consumes the owner's
assessment once, takes the same patient/category lock as templates, and creates
the document, attributed DOCUMENT_SUBMITTED event and receipt atomically.
`other` and missing categories remain exempt. Duplicate rejection leaves the
existing document and the new assessment untouched. Additional outcomes are
`assessment_not_found` and `file_invalid`.

The assessed pending object is promoted in place, without a copy. The transaction
locks and validates its Storage metadata and seals it before recording the
document. A trigger rejects deletion/replacement of an object while a document
references it, including cleanup attempts. When the patient cancels a pending
document (web patient/submissions deletes the row first), the file can be
removed as before. The seal keeps a delete that raced the commit from passing
the patient's delete policy. Rollback restores the pending row and removes the
seal; no second/final orphan object exists. This changes the pending path's
lifecycle, not the existing permitted upload prefix. Deploy the migration before
the new web confirmation and Edge routes. Keep receipts indefinitely. Revert
callers before rollback; retain seals/trigger for submitted files and retained
upload receipts. The trigger freezes only the columns that identify the file
(id, bucket, name, owner, version, metadata, user_metadata, archive and delete
markers), so Storage bookkeeping and column backfills in later Storage releases
still pass. Before applying, it was exercised through the real Storage API on a
disposable local stack at production's Storage migration (73): downloads and
signed URLs work, delete/upsert/move of a referenced file are refused for the
patient and the service role, and removal after cancel works.

Detected tests on mobile uploads come from OCR the client wrote into its own
pending row, so they carry `test_detection_source: "client_ocr_catalog_match"`;
web's server-side OCR keeps `"ocr_text_catalog_match"`. Reception sees the
original file either way.

### Migration 43 — RLS auth calls evaluated once per statement (#235, not yet applied)

`src/lib/db/migration_43.sql` recreates all 51 policies (47 in `public`, 4 on
`storage.objects`) under the same names, commands, roles and USING/WITH CHECK
logic. The only change is that every `auth.uid()`, `user_has_permission(...)`,
`get_auth_user_role()` and `get_auth_user_dept()` call is written as
`(select ...)`, so Postgres runs it once per statement as an InitPlan instead of
once per row. Left bare, `user_has_permission` made counting `system_logs` take
820 ms for an admin. `tools/perf/rls-policy-diff.mjs` proves the policy set and
expressions are unchanged apart from those wrappers, and that the plan has an
InitPlan. Function volatility is unchanged. Apply after merge, then regenerate
`schema.sql`.

### Migration 47 — profiles self-update recursion (#256, not yet applied)

`src/lib/db/migration_47.sql` fixes the failure any patient hit saving privacy
consent: updating their own `public.profiles` row raised
`infinite recursion detected in policy for relation "profiles"` (SQLSTATE
42P17), so `accepted_privacy_at` from
`src/app/(auth)/privacy-agreement/actions.ts` and mobile sign-up could never be
saved. The cause was the "Users can update own profile details" `WITH CHECK`,
which guarded the protected columns (`role`, `role_id`, `department`,
`is_active`, `email_verified_at`) with sub-selects on `profiles` itself, and
expanding those re-applies the `profiles` policies. Migration 43 kept the
sub-selects, so applying it did not help.

The migration moves the guard out of the policy and into a `BEFORE UPDATE FOR
EACH ROW` trigger, `public.protect_profile_columns()`, which compares NEW with
OLD instead of re-reading the row. A change to any of the five columns is
allowed only for a non end-user session (`service_role`, `SECURITY DEFINER`
functions such as `sync_email_verified_at`) or a caller holding
`profiles.manage`; otherwise it raises 42501. `WITH CHECK` on the same policy is
reduced to `(select auth.uid()) = id`; its `USING` and `TO authenticated` are
unchanged, so an inactive patient still cannot update their own row. The only
other `BEFORE` trigger on `profiles`, `profiles_sync_legacy_role`, sorts before
the guard by name, so the guard compares the legacy-derived `role`. No other
policy or table grant changes.

`tools/db/profiles-update-guard-check.mjs` proves it in a throwaway Postgres:
before the migration a patient self-update of `accepted_privacy_at` reproduces
42P17; after, the patient can save `accepted_privacy_at` and their name, is
refused (42501) on each of the five protected columns, cannot touch another
user's row, and an inactive patient cannot update at all, while a
`profiles.manage` admin, `service_role` and the `sync_email_verified_at` definer
path can still change the protected columns.

**Ordering:** 43 is already applied, and its re-created "Users can update own
profile details" is the recursive policy this migration replaces, so 47 must be
applied after 43. 47 does not depend on 44, 45 or 46. If 43 is ever re-run,
re-run 47 afterwards. `SNAPSHOT`: written but not applied; do not regenerate
`schema.sql` until applied.
