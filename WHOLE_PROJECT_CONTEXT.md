# WHOLE_PROJECT_CONTEXT.md
## KlinikAid — Comprehensive Project Context
### Paste at the top of every AI assistant prompt for this project

**Last Updated:** 2026-07-01
**Supersedes:** `MASTER_CONTEXT.md`, `MASTER_CONTEXT_11.md`, `MASTER_CONTEXT_bugfixing.md`

---

## 1. PROJECT IDENTITY

| Field | Value |
|---|---|
| **System Name** | KlinikAid |
| **Client** | Bloodcare Medical Laboratory, Burgos, Rodriguez, Rizal |
| **Type** | Multi-role internal clinic management web portal |
| **Context** | Academic capstone (Healthioneers team) |
| **Scope** | **Web portal only.** Mobile app (Flutter, separate team) consumes the shared Supabase backend and Supabase Edge Functions. The web and mobile teams share `supabase/functions/`, `schema.sql`, and RLS policies but do NOT share Next.js code. |
| **Deployment** | Vercel (web) + Supabase (DB, Auth, Storage, Edge Functions) |
| **Repository** | `Setsuna-guwah/KlinikAid` on GitHub |

---

## 2. THE FIVE OBJECTIVES (Non-Negotiable)

Every feature in the project maps to exactly one of these. Never add scope outside them.

| ID | Objective | Summary |
|---|---|---|
| **SO-A** | AI Chatbot + Document Submission | RAG-grounded 24/7 AI clinic inquiry chatbot (Gemini 2.5 Flash + pgvector) + web document submission pathway for patients |
| **SO-B** | Centralized Staff Portal | Automated document validation, patient queue management, reduced manual data entry across reception and department staff workflows |
| **SO-C** | Descriptive Analytics | Longitudinal lab data vs. reference ranges, read-only specialist view, **NO AI diagnostics** |
| **SO-D** | Department Isolation | Each department staff member sees/edits only their own department's records. Enforced by RLS `get_auth_user_dept()` + application guards. Admins bypass. |
| **SO-E** | Data Privacy & Audit | Republic Act 10173 (DPA) consent gate, comprehensive `system_logs` audit trail, MFA for staff, signed URL document access |

---

## 3. CONFIRMED TECH STACK

> **CAUTION:** The specific versions and model names below have been validated through production deployments. Do NOT substitute without explicit team alignment.

| Layer | Tool | Constraint |
|---|---|---|
| **Framework** | Next.js 14.2.35 (App Router, React 18) | Server Components + Client Components split. NOT React 19. |
| **Language** | TypeScript 5 | Strict mode |
| **Styling** | Tailwind CSS **v3.4** (NOT v4) | HSL CSS variables via `globals.css`, custom `accentBlue` palette |
| **UI Components** | shadcn/ui (`base-nova` style) | AlertDialog from `@base-ui/react` (NOT Radix). Icons: `lucide-react`. |
| **Charts** | Recharts **v3.8** (raw) | NOT shadcn chart wrappers. Direct `ComposedChart`, `LineChart`, `BarChart`. |
| **Database** | Supabase PostgreSQL | pgvector extension enabled, RLS on every table |
| **Auth** | Supabase Auth (@supabase/ssr) | Cookie-based for web, JWT Bearer for mobile |
| **Storage** | Supabase Storage (`patient-documents` bucket) | Private bucket, signed URLs only |
| **Embedding Model** | `gemini-embedding-001` | 768 dimensions (NOT 1536). Use `outputDimensionality: 768` in SDK, `output_dimensionality: 768` (snake_case) in REST. |
| **Generation Model** | `gemini-2.5-flash` | System prompt grounding, NO diagnostics |
| **AI SDK (Web)** | `@google/generative-ai` v0.24 | Node.js SDK, camelCase API |
| **AI SDK (Mobile)** | Raw Gemini REST via `fetch()` | Deno runtime, snake_case fields. See Edge Function. |
| **Vector Dimensions** | 768 | Match `rag_documents.embedding vector(768)` and `match_documents` RPC |
| **Timezone** | Asia/Manila (UTC+8) | All user-facing dates via `formatPhTime()` / `formatPhTimeFull()` from `src/lib/utils.ts` |
| **Forms** | `react-hook-form` + `zod` v4 + `@hookform/resolvers` | |
| **Email** | `resend` (optional, transactional) | |
| **Deployment** | Vercel (auto-deploy from GitHub) | `.vercelignore` excludes `supabase/` |

---

## 4. DATABASE SCHEMA

### 4.1 Tables (8 tables, all with RLS enabled)

| Table | PK Type | Purpose | Key Columns |
|---|---|---|---|
| `profiles` | `uuid` (FK to `auth.users`) | Extends auth users with role, department, active status | `role` (enum), `department` (enum), `is_active`, `accepted_privacy_at` |
| `patients` | `uuid` | Patient demographics | `profile_id` (FK to profiles, nullable), `first_name`, `last_name`, `date_of_birth`, `gender`, `contact_number`, `address` |
| `patient_queue` | `bigint IDENTITY` | Active department queue | `patient_id`, `status` (waiting/in_progress/completed/cancelled), `department`, `priority_level` (routine/urgent/emergency), `triage_notes` |
| `documents` | `uuid` | Patient document submissions | `patient_id`, `uploader_id`, `file_name`, `file_path`, `status` (pending/approved/rejected), `ocr_text`, `extracted_metadata`, `rejection_reason` |
| `department_records` | `uuid` | Diagnostic test results (flat relational) | `patient_id`, `recorder_id`, `department`, `test_type`, `test_name`, `test_value`, `unit`, `reference_range_min/max`, `is_flagged` |
| `system_logs` | `bigint IDENTITY` | Audit trail | `user_id`, `event_type`, `description`, `ip_address`, `metadata` (jsonb) |
| `chatbot_logs` | `bigint IDENTITY` | AI chatbot interactions | `user_id`, `session_id`, `user_message`, `bot_response`, `tokens_used`, `feedback` (helpful/unhelpful) |
| `rag_documents` | `uuid` | RAG knowledge base chunks | `title`, `content`, `embedding` (vector(768)), `metadata` (jsonb) |

### 4.2 Enums (Check Constraints)

| Type | Values |
|---|---|
| `role` | `admin`, `receptionist`, `department_staff`, `medical_specialist`, `patient` |
| `department` | `laboratory`, `imaging`, `ultrasound`, `ecg` |
| `queue_status` | `waiting`, `in_progress`, `completed`, `cancelled` |
| `priority_level` | `routine`, `urgent`, `emergency` |
| `document_status` | `pending`, `approved`, `rejected` |
| `feedback` | `helpful`, `unhelpful` |

### 4.3 Key Functions & Triggers

| Name | Purpose |
|---|---|
| `handle_new_user()` | Trigger on `auth.users` INSERT — auto-creates `profiles` row + logs `USER_REGISTERED` |
| `get_auth_user_role()` | SECURITY DEFINER helper for RLS policies (prevents recursion) |
| `get_auth_user_dept()` | SECURITY DEFINER helper for department isolation RLS |
| `match_documents(query_embedding, match_threshold, match_count)` | pgvector cosine similarity search on `rag_documents` |
| `get_daily_token_usage(start_date)` | Aggregates chatbot token usage by day (Asia/Manila TZ) |

### 4.4 Migrations (Applied Sequentially)

| File | Purpose |
|---|---|
| `schema.sql` | Base schema — all 8 tables, RLS policies, triggers |
| `migration_07.sql` | `match_documents` RPC function for RAG |
| `migration_08.sql` | `get_daily_token_usage` function + chatbot session index |
| `migration_09.sql` | Storage bucket `patient-documents` + storage RLS policies |
| `migration_10.sql` | `accepted_privacy_at` column on profiles |

### 4.5 Storage Bucket

- **Name:** `patient-documents` (private)
- **Path schema:** `${profile_id}/${uuid}.${ext}`
- **Access:** Patients read/write own prefix only; admin/receptionist read all

---

## 5. FILE STRUCTURE (Grouped by Feature)

### 5.1 Root Config

| File | Purpose |
|---|---|
| `package.json` | Dependencies and scripts (`dev`, `build`, `start`, `lint`, `review`) |
| `tailwind.config.ts` | Tailwind v3, HSL variables, custom `accentBlue` palette, `tailwindcss-animate` plugin |
| `components.json` | shadcn/ui config — `base-nova` style, `lucide` icons |
| `next.config.mjs` | Minimal Next.js config |
| `tsconfig.json` | TypeScript config, excludes `supabase/` from build |
| `.env.example` | Documented env vars template |
| `.vercelignore` | Excludes `supabase/` from Vercel deployment |

### 5.2 `src/middleware.ts` — Route Middleware

- Refreshes Supabase session on every request
- Redirects unauthenticated users from protected routes to `/login`
- Redirects authenticated users from `/login` or `/` to their role dashboard
- Sets `x-pathname` header for the layout gate

### 5.3 `src/lib/` — Shared Libraries

| File | Purpose |
|---|---|
| `supabase/server.ts` | Server-side Supabase client (Server Components, Actions, Route Handlers) |
| `supabase/client.ts` | Browser-side Supabase client (Client Components) |
| `supabase/admin.ts` | Service-role admin client (bypasses RLS, server-only, throws if imported client-side) |
| `supabase/middleware.ts` | Session refresh helper for Next.js middleware |
| `auth/helpers.ts` | `getCurrentUser()`, `requireRole(roles[])`, `requireDepartment(depts[])` |
| `logger.ts` | `logEvent(supabase, userId, eventType, description, ip?, metadata?)` — audit trail writer, never throws |
| `constants.ts` | `USER_ROLES`, `DEPARTMENTS`, `DOCUMENT_STATUSES`, `QUEUE_STATUSES`, `REFERENCE_RANGE_STATUSES`, `LAB_REFERENCE_RANGES` (6 lab parameters), `CHART_COLORS`, `GEMINI_BLENDED_USD_PER_1M_TOKENS`, `SYSTEM_EVENT_TYPES` (19+ events), `WEB_OCR_ENABLED` |
| `api-response.ts` | `successResponse(data)`, `errorResponse(message, status)` — sanitized JSON responses (Rule #6) |
| `utils.ts` | `cn()` (clsx+twMerge), `getAge(dob)`, `formatPhTime(date)`, `formatPhTimeFull(date)`, `getPhtStartOfToday()` |
| `patient/createPatient.ts` | Patient creation helper with Supabase Auth signup |
| `documents/extractDocumentText.ts` | Document text extraction utility |

### 5.4 `src/types/index.ts` — Type Definitions

Exports: `UserRole`, `Department`, `QueueStatus`, `PriorityLevel`, `DocumentStatus`, `ReferenceRangeStatus`, `FeedbackType`, `Profile`, `Patient`, `PatientQueue`, `Document`, `DepartmentRecord`, `SystemLog`, `ChatbotLog`, `RagDocument`

### 5.5 `src/app/(auth)/` — Authentication Routes

| Route | Files | Purpose |
|---|---|---|
| `/login` | `page.tsx`, `actions.ts` | Login form with inline TOTP MFA challenge (no separate MFA page). Server action handles password to MFA flow to role redirect. |
| `/register` | `page.tsx`, `actions.ts` | Patient self-registration form |
| `/logout` | `actions.ts` | Sign-out with audit log |
| `/privacy-agreement` | `page.tsx`, `PrivacyAgreementClient.tsx`, `actions.ts` | RA 10173 DPA consent gate for patients. Must accept before accessing any dashboard. |
| `/mfa-enroll` | `page.tsx`, `MfaEnrollClient.tsx`, `actions.ts` | Staff TOTP enrollment. Cleans up stale unverified factors, displays QR code, verifies code. `MFA_ENROLLED` logged after verify. |

### 5.6 `src/app/(dashboard)/layout.tsx` — Dashboard Layout & Security Gate

Shared layout for all dashboard routes. Enforces (in order):
1. Authentication check
2. Profile fetch
3. Active account check
4. Patient privacy agreement gate
5. **Staff MFA enrollment gate** — redirects staff without verified TOTP factor to `/mfa-enroll`
6. Role-to-route mismatch check — `ACCESS_DENIED` log + redirect to `/403`

### 5.7 `src/app/(dashboard)/admin/` — Administrator Module

| Route | Key Files | Purpose |
|---|---|---|
| `/admin/dashboard` | `page.tsx`, `DepartmentChart.tsx` | System overview: user counts, queue stats, department workload bar chart |
| `/admin/staff` | `page.tsx` | Staff CRUD: create/edit/activate/deactivate portal users |
| `/admin/rag` | `page.tsx`, `actions.ts` | RAG knowledge base manager: upload/delete text chunks with auto-embedding |
| `/admin/logs` | `page.tsx`, `LogsDashboardClient.tsx` | System audit logs viewer with filtering, export (JSON/CSV) |

### 5.8 `src/app/(dashboard)/reception/` — Receptionist Module

| Route | Key Files | Purpose |
|---|---|---|
| `/reception/dashboard` | `page.tsx` | Reception overview with live stats |
| `/reception/queue` | `page.tsx`, `[documentId]/page.tsx` | Document validation queue |
| `/reception/documents` | `page.tsx` | Document list view |

### 5.9 `src/app/(dashboard)/department/` — Department Staff Module

| Route | Key Files | Purpose |
|---|---|---|
| `/department/dashboard` | `page.tsx` | Department overview (redirects to records) |
| `/department/records` | `page.tsx` | Department records list filtered by user's department |
| `/department/records/entry/[patientId]` | `page.tsx` | Record entry form — auto-flagging, modality adaptation |
| `/department/documents` | `page.tsx` | Department document view |
| `/department/entry` | `page.tsx` | Entry point redirect |

### 5.10 `src/app/(dashboard)/specialist/` — Medical Specialist Module

| Route | Key Files | Purpose |
|---|---|---|
| `/specialist/dashboard` | `page.tsx` | Specialist landing page |
| `/specialist/patients` | `page.tsx`, `[patientId]/analytics/page.tsx` | Patient search + per-patient longitudinal analytics |
| `/specialist/analytics` | `page.tsx` | Redirects to `/specialist/patients` (stub) |

### 5.11 `src/app/(dashboard)/patient/` — Patient Module

| Route | Key Files | Purpose |
|---|---|---|
| `/patient/dashboard` | `page.tsx` | Patient overview: queue status, recent submissions |
| `/patient/chat` | `page.tsx`, `PatientChatClient.tsx` | RAG chatbot UI |
| `/patient/submit` | `page.tsx`, `DocumentSubmitClient.tsx`, `actions.ts` | Document upload to private storage |
| `/patient/submissions` | `page.tsx`, `SubmissionsClient.tsx`, `actions.ts` | Track submission status |
| `/patient/results` | `page.tsx`, `PatientResultsClient.tsx` | View lab/imaging results |

### 5.12 `src/app/api/` — API Routes

| Route | Method(s) | Purpose |
|---|---|---|
| `/api/chat` | POST | RAG chatbot pipeline (web client). Cookie auth, `messages[]` body. |
| `/api/admin/staff` | GET, POST | List/create staff users |
| `/api/admin/staff/[id]` | PUT, PATCH | Update/activate/deactivate staff |
| `/api/admin/dashboard-stats` | GET | System dashboard statistics |
| `/api/admin/logs/system` | GET | System log queries |
| `/api/admin/logs/chatbot` | GET | Chatbot log queries |
| `/api/admin/logs/api-costs` | GET | API cost analytics |
| `/api/department/queue` | GET | Department queue entries |
| `/api/department/records` | GET, POST | Department records CRUD |
| `/api/department/patients` | GET | Patient lookup for department |
| `/api/reception/documents` | GET | Document listing for reception |
| `/api/reception/triage` | POST | Triage routing (queue insertion) |
| `/api/specialist/patients` | GET | Patient search for specialists |

### 5.13 `supabase/functions/chat/` — Supabase Edge Function

- **Runtime:** Deno
- **Auth:** JWT Bearer header (not cookies)
- **Request:** `{ "message": string, "session_id": string }`
- **Response:** `{ "response": string, "log_id": number }`
- **Purpose:** Identical RAG chatbot pipeline for mobile Flutter client
- **Deploy:** `supabase functions deploy chat`

> **IMPORTANT:** The chatbot has **TWO parallel implementations** — web (`src/app/api/chat/route.ts`) and mobile (`supabase/functions/chat/index.ts`). Any change to rate limit (20/hr), model strings, `match_documents` args, system prompt, or `chatbot_logs` columns **MUST** be applied to BOTH files.

### 5.14 `src/components/` — Shared Components

| File | Purpose |
|---|---|
| `sidebar.tsx` | Role-based navigation sidebar with logout |
| `LogEventBadge.tsx` | Color-coded event type badges for audit logs |
| `ReceptionKanban.tsx` | Document validation Kanban board |
| `TriageModal.tsx` | Patient triage routing modal |
| `DocumentApprovalClient.tsx` | 3-panel document approval view |
| `DepartmentRecordsClient.tsx` | Department records table with filtering |
| `RecordEntryClient.tsx` | Diagnostic record entry form |
| `RagManagerClient.tsx` | RAG knowledge base management UI |
| `SpecialistDashboardClient.tsx` | Specialist landing page content |
| `SpecialistPatientsClient.tsx` | Patient search and listing |
| `SpecialistAnalyticsClient.tsx` | Longitudinal charting with Recharts |
| `ui/` | shadcn/ui primitives (alert-dialog, alert, badge, button, card, dialog, input, label, progress, select, sheet, sonner, switch, table, textarea) |

---

## 6. THE ELEVEN STANDING CODE RULES

1. **Session First** — `supabase.auth.getUser()` as literal first line of every Server Action/API Route
2. **Role from DB Only** — Role/department from `profiles` table, never from cookies/headers/body
3. **RLS on Every Table** — All tables and storage buckets have RLS enabled
4. **Service Role Key Server-Only** — `SUPABASE_SERVICE_ROLE_KEY` never in `"use client"` code
5. **Log Significant Actions** — `logEvent()` for all critical transactions, using `SYSTEM_EVENT_TYPES` constants
6. **No Raw Errors to Clients** — Log raw errors server-side, send clean messages via `errorResponse()`
7. **Server + Client Layout Split** — Server Components for data/auth, Client Components for interactivity
8. **`useSearchParams()` Inside `<Suspense>`** — Prevent Next.js build failures
9. **UTC+8 Timestamp Formatting** — All dates via `formatPhTime()` / `formatPhTimeFull()`
10. **Real-time Payloads Without Joins** — Raw PKs in realtime, join client-side
11. **`process.env` is Server-Only** — Pass env values as props, never read in client code

---

## 7. SYSTEM EVENT TYPES (21 Registered)

| Constant | Emitted By |
|---|---|
| `LOGIN_SUCCESS` | Successful login (password or MFA) |
| `LOGIN_FAILED` | Failed password/MFA/inactive attempts |
| `LOGOUT` | Sign-out action |
| `USER_REGISTERED` | Patient registration + DB trigger |
| `STAFF_CREATED` | Admin creates staff user |
| `STAFF_UPDATED` | Admin edits staff profile |
| `STAFF_ACTIVATED` | Admin reactivates staff |
| `STAFF_DEACTIVATED` | Admin deactivates staff (signs out all devices) |
| `DOCUMENT_APPROVED` | Reception approves document + creates queue entry |
| `DOCUMENT_REJECTED` | Reception rejects document with reason |
| `TRIAGE_COMPLETED` | Legacy triage routing |
| `RECORD_ENTERED` | Department staff records test result |
| `RAG_DOCUMENT_UPLOADED` | Admin uploads RAG chunk |
| `RAG_DOCUMENT_DELETED` | Admin deletes RAG chunk |
| `ACCESS_DENIED` | Layout gate rejects unauthorized path |
| `EXPORT_SYSTEM_LOGS` | Admin exports audit logs |
| `STAFF_ACTION_FAILED` | Staff action error |
| `DOCUMENT_SUBMITTED` | Patient uploads document |
| `PRIVACY_ACCEPTED` | Patient accepts DPA consent |
| `QUEUE_COMPLETED` | Queue entry completed (Batch 1 bugfix) |
| `MFA_ENROLLED` | Staff completes TOTP MFA setup |

---

## 8. AUTHENTICATION & SECURITY FLOW

### 8.1 Login Flow
1. Email + password via `signInWithPassword()`
2. Fetch profile, check `is_active`
3. Check MFA AAL level:
   - `nextLevel === "aal2"` + `currentLevel === "aal1"` — prompt TOTP code inline
   - `listFactors()` — find verified TOTP factor — `challenge()` — `verify()`
4. Log `LOGIN_SUCCESS`, redirect to role dashboard

### 8.2 MFA Enrollment Gate (Staff Only)
- Dashboard layout checks `listFactors()` for verified TOTP factor
- Staff without verified factor redirected to `/mfa-enroll`
- `/mfa-enroll` cleans up stale unverified factors via `unenroll()` before calling `enroll()`
- Uses `useRef`-guarded effect to prevent React StrictMode double-invocation
- `MFA_ENROLLED` logged only after successful `verify()`

### 8.3 Privacy Agreement Gate (Patients Only)
- Dashboard layout checks `accepted_privacy_at` on profile
- Patients without consent redirected to `/privacy-agreement`
- Must accept RA 10173 DPA consent before accessing any feature

### 8.4 Role Gate (Dashboard Layout)
- Middleware sets `x-pathname` header
- Layout matches pathname prefix to user role
- Mismatch: logs `ACCESS_DENIED` with IP + path, redirects to `/403`
- Admin bypasses all route checks

---

## 9. RAG CHATBOT PIPELINE

```
User Message -> Auth + Rate Limit (20/hr per user_id)
  -> Embed via gemini-embedding-001 (768-dim)
  -> match_documents RPC (cosine similarity >= 0.6, top 5)
  -> Construct grounded system prompt
  -> Generate via gemini-2.5-flash
  -> Log to chatbot_logs (session_id, tokens_used)
  -> Return response
```

### Critical Sync Points (Web and Mobile)
| Parameter | Value |
|---|---|
| Rate limit | 20 messages/hour per `user_id` |
| Embedding model | `gemini-embedding-001` |
| Embedding dimensions | 768 |
| Similarity threshold | 0.6 |
| Match count | 5 |
| Generation model | `gemini-2.5-flash` |
| System prompt | Identical text in both files |
| Log columns | `user_id`, `session_id`, `user_message`, `bot_response`, `tokens_used` |

### REST API Gotcha (Edge Function)
- Embedding endpoint: `POST .../models/gemini-embedding-001:embedContent`
- Body field: `output_dimensionality` (snake_case!) — camelCase silently returns 3072-dim vectors
- Body must include: `"model": "models/gemini-embedding-001"` with `models/` prefix
- Generation endpoint: `POST .../models/gemini-2.5-flash:generateContent`

---

## 10. ENVIRONMENT VARIABLES

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase anon key (RLS-locked) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** | Bypasses RLS — admin operations |
| `GEMINI_API_KEY` | Server-only | Google Gemini API key |
| `RESEND_API_KEY` | Server-only | Resend email API key (optional) |
| `NEXT_PUBLIC_CLINIC_NAME` | Public | "Bloodcare Medical Laboratory" |
| `NEXT_PUBLIC_CLINIC_ADDRESS` | Public | "Burgos, Rodriguez, Rizal" |
| `FREE_TIER_TOKEN_LIMIT` | Server-only | Token budget (10M) |
| `CHAT_RATE_LIMIT_PER_HOUR` | Server-only | Documentation-only (hardcoded as 20) |

For the Edge Function, set via `supabase secrets set`:
- `GEMINI_API_KEY` — required
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — auto-provided by Supabase runtime

---

## 11. DESIGN SYSTEM

### 11.1 Theme Colors
- **Primary:** Forest Green `hsl(133 21% 31%)` — `#3f6146`
- **Background (Light):** Warm Cream `hsl(36 53% 93%)`
- **Background (Dark):** Deep Navy `hsl(222.2 84% 4.9%)`
- **Accent Blue:** Custom `accentBlue-50` through `accentBlue-950` scale
- **Chart Colors:** Defined in `CHART_COLORS` constant

### 11.2 Component System
- shadcn/ui `base-nova` style with HSL CSS variables
- AlertDialog from `@base-ui/react` (NOT Radix)
- Icons from `lucide-react`
- Tailwind `class-variance-authority` for component variants

---

## 12. DEVELOPMENT CONVENTIONS

### 12.1 Folder Naming
- Route folders: lowercase, grouped under `(auth)` or `(dashboard)`
- Server pages: `page.tsx` (Server Component, data fetching + auth gate)
- Client files: `[Feature]Client.tsx` (CamelCase, co-located with page)
- Migrations: `src/lib/db/migration_[XX].sql` (sequential) + update `schema.sql`

### 12.2 Commit Format
```
type(scope): message
```
Types: `feat`, `fix`, `docs`, `build`, `refactor`, `chore`

### 12.3 Git History (Development Phases)
| Phase | Commit | What Was Built |
|---|---|---|
| 1 | `b6e712e` | Project setup, DB schema, Supabase clients, Tailwind system |
| 2 | `99932b2` | Multi-role auth, dynamic sidebar, middleware guards |
| 3 | `183f0ba` | Admin dashboard, staff CRUD, workload charts |
| 4 | `557ece6` | Reception module, document validation, Kanban, triage |
| 5 | `973ae98` | Department staff module, relational records, auto-flagging |
| 6 | `afb353a` | Specialist analytics, Recharts longitudinal charting |
| 7 | `7fb1345` | RAG admin, chatbot API, pgvector integration |
| 8 | `e02bf81` | System logs module, audit export |
| 9a | `ef16e83` | Patient auth, dashboard, RAG chat UI |
| 9b | `399d30b` | Document submission, status tracker, results viewer |
| 10 | `e0210c0` | Polish: log constants, dev cleanup, layout fallbacks |
| 10.5 | `5f25e7c` | Fail-closed role gate fix, session ID fallback |
| DPA | `0c316e9` | Privacy agreement gate, sidebar/routing fixes |
| Theme | `d2c1f09` | Green + cream recoloring, accentBlue config |
| Docs | `f66b400` | Architecture, database, conventions documentation |
| Edge Fn | `af2c8b5` | Supabase Edge Function `chat` for mobile |
| Build | `8c940a2` | Exclude supabase/ from Next.js TS build |

### 12.4 Uncommitted Work (As of 2026-07-01)
The following changes exist on the working tree (from Batch 1 bugfixes + MFA enrollment):
- Bugfix Batch 1: Queue completion flow, duplicate queue guard (409), record entry fixes in `department/records`, `department/queue`, `reception/triage`, `reception/dashboard`, `admin/dashboard`
- MFA Batch 1.5: New `/mfa-enroll` route, dashboard layout MFA gate, `MFA_ENROLLED` event, `LogEventBadge` styling
- Utility additions: `getPhtStartOfToday()` in `utils.ts`, `QUEUE_COMPLETED` + `MFA_ENROLLED` in constants

---

## 13. KNOWN GOTCHAS & HARD-WON LESSONS

> **WARNING:** These are documented pitfalls discovered during development. Ignoring them will cause bugs.

### 13.1 Gemini REST API
- `output_dimensionality` must be **snake_case** in raw REST calls. CamelCase silently returns 3072-dim vectors which breaks `match_documents` (expects 768-dim).
- The Node.js SDK (`@google/generative-ai`) handles the conversion internally — only the Edge Function (Deno, raw REST) needs snake_case.
- `gemini-embedding-001` is the correct model. `text-embedding-004` returned 404 in this environment.
- Body must include `"model": "models/gemini-embedding-001"` with `models/` prefix.

### 13.2 MFA Enrollment
- React StrictMode double-invokes useEffect which causes `enroll()` to be called twice, resulting in "friendly name already exists" error. Guarded with `useRef` + `active` flag.
- Must `unenroll()` stale unverified factors before calling `enroll()`. Use `listFactors()` and filter `status === "unverified"`.
- Never use AAL-level check alone for enrollment status — unverified TOTP factors confuse it. Use `listFactors()` + filter `status === "verified"`.

### 13.3 Queue Management
- On record entry, must complete existing queue entries (`WHERE status IN ('waiting','in_progress')`) in ONE update, not two.
- Only emit `QUEUE_COMPLETED` log event when the update actually flips at least one row. Check result count.
- Duplicate queue guard returns 409 with **human-readable** text (e.g., "Patient already in Laboratory queue"), never raw status enum values.

### 13.4 UUID Search
- PostgreSQL `LIKE` operator doesn't work with UUID columns. Use range-based queries: `.gte(prefix + "000...")` / `.lte(prefix + "fff...")`.

### 13.5 Recharts
- Define `CustomTooltip` components OUTSIDE the parent render function to prevent tooltip unmounting/flickering.
- Use raw Recharts `ComposedChart`, not shadcn chart wrappers.

### 13.6 Specialist Analytics Redirect
- `/specialist/analytics` page redirects to `/specialist/patients`. Individual analytics at `/specialist/patients/[patientId]/analytics`.

### 13.7 RAG Chunking
- `chunkText` uses character-based slicing (1000 chars, 200 overlap), not sentence-aware. This is intentional.

### 13.8 Rate Limit
- `.env.example` lists `CHAT_RATE_LIMIT_PER_HOUR=20` but the value is hardcoded in both chat handlers. The env var is documentation-only.

### 13.9 Real-time Subscriptions
- Don't construct complex JOINs inside Supabase realtime subscriptions. Send raw PKs, join client-side.

### 13.10 Next.js Build
- `supabase/` directory excluded from TypeScript compilation via `tsconfig.json` `exclude` field and `.vercelignore`
- The Edge Function uses Deno APIs and imports from `esm.sh` — incompatible with Node.js TS compiler

### 13.11 Department Naming
- Always use `imaging` in the database, never `xray`. The display label is "Imaging (X-Ray)" in `DEPARTMENTS` constant.

### 13.12 Supabase Client Import Paths
- Server code: `import { createClient } from "@/lib/supabase/server"`
- Client code: `import { createClient } from "@/lib/supabase/client"`
- Admin (RLS bypass): `import { createAdminClient } from "@/lib/supabase/admin"`
- **Never mix these up** — using server client in client code or vice versa causes auth failures.

### 13.13 Privacy Agreement Redirect Loop
- The privacy agreement gate only applies to `patient` role. Staff roles skip it entirely.
- If `accepted_privacy_at` is null for a patient, they cannot reach ANY dashboard page.

---

## 14. TESTING & VERIFICATION

### 14.1 Build Verification
```bash
npm run build
```
Must pass with zero errors before any commit.

### 14.2 Code Review Script
```bash
npm run review
```
Runs the `scripts/review.js` automated review.

### 14.3 Manual Testing Checklist
- Login and role redirect works for all 5 roles
- MFA enrollment gate triggers for staff without verified factor
- Privacy agreement gate triggers for patients without consent
- Role mismatch results in 403 page + audit log
- Document upload, submission tracking, approval/rejection flow
- Queue entry, department record entry, results visible to patient + specialist
- RAG chatbot responds with grounded answers
- Rate limit (20/hr) blocks excessive chatbot use
- Admin can create/edit/deactivate staff
- System logs capture all events with correct metadata

---

## 15. DEPLOYMENT CHECKLIST

### Vercel (Web)
1. Set env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`
2. Push to GitHub for auto-deploy via Vercel

### Supabase
1. Run all migrations in SQL editor (schema.sql then migration_07 through migration_10)
2. Enable RLS on all tables
3. Create `patient-documents` storage bucket (private)
4. Set secrets: `supabase secrets set GEMINI_API_KEY=<value>`
5. Deploy Edge Function: `supabase functions deploy chat`
6. Enable email confirmation in Auth settings

### Supabase Auth Config
- **Email Confirmation:** ON (for patient registration)
- **MFA:** TOTP enabled (for staff enrollment)
