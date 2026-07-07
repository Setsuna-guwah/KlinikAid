# Coding Standards & Conventions
*Developer guidelines, codebase constraints, naming standards, and known limitations in KlinikAid*

This document outlines the coding regulations and standards that developers must follow when contributing to the KlinikAid codebase.

---

## The Eleven Standing Code Rules

All feature development and refactoring passes must adhere to these eleven foundational coding rules:

1. **Session First**:
   Every Server Action or API Route must call `supabase.auth.getUser()` as its literal first line of execution. Request parsing and operations must fail immediately with an HTTP 401 error if no session is active. *(Exception: Public sign-up/registration pathway).*
2. **Role from DB Only**:
   Retrieve the user role and clinical department attributes solely from the `public.profiles` table using the authenticated user's ID (`auth.uid()`). **Never** read, trust, or parse role/department data from cookies, request parameters, page headers, or the POST request body.
3. **RLS on Every Table**:
   Every database table and storage bucket must have Row-Level Security (RLS) enabled. Write clear policies that restrict access based on verified session roles and user ID scopes.
4. **Service Role Key Server-Only**:
   The `SUPABASE_SERVICE_ROLE_KEY` must **never** be imported or used in client-side code (`"use client"`). Signed URL creation and administrative user modifications are restricted to server-side code execution.
5. **Log Significant Actions**:
   Trigger `logEvent()` to record audit logs into `system_logs` for critical transactions (logins, registrations, record entries, data updates, and security errors). Map event types using the type-safe `SYSTEM_EVENT_TYPES` constant.
6. **No Raw Errors to Clients**:
   Do not expose raw system or database error objects to the browser. Log raw stack traces to the server console and send generic, clean user-facing feedback using the `errorResponse()` helper.
7. **Server + Client Layout Split**:
   Keep layouts clean: use Server Components for data prefetching and security gates, and co-locate Client Components (`"use client"`) underneath the same route folder to handle UI interactivity.
8. **`useSearchParams()` Inside `<Suspense>`**:
   Any client-side component calling the `useSearchParams()` Next.js hook must be wrapped inside a `<Suspense>` boundary to prevent build failures during static generation passes.
9. **UTC+8 Timestamp Formatting**:
   Ensure all user-facing dates and timestamps render in Asia/Manila (UTC+8) timezone. Use the shared utility `formatPhTime(date)` to ensure uniformity.
10. **Real-time Payloads Without Joins**:
    Do not construct complex PostgreSQL database joins inside real-time subscriptions. Send raw model primary keys and handle relation queries on the client side to avoid rendering glitches.
11. **`process.env` is Server-Only**:
    Do not call `process.env` from client-side code. Retrieve environment variables in Server Components and pass them down as typed props.
12. **No AI Diagnostics**:
    The system performs NO AI diagnostic inference on patient data anywhere. All analytics are descriptive only (SO-C). AI (Gemini) is used for RAG chatbot grounding and document text extraction ONLY — never clinical interpretation, diagnosis, or prognosis. Human clinicians (specialists) make all diagnostic judgments; the system stores and displays, never interprets. This applies equally to the specialist private workspace — descriptive charts only, no AI-generated clinical conclusions.

---

## Naming & Folder Conventions

- **Route folders**: Lowercase, grouped under `(auth)` or `(dashboard)`.
- **Server views (`page.tsx`)**: Renders server-side gates and fetches props.
- **Client files (`[Feature]Client.tsx`)**: Capitalized CamelCase, co-located in the page directory.
- **Database Migrations**: Placed in `src/lib/db/` named sequentially as `migration_[XX].sql`. Add corresponding changes to the canonical `schema.sql` at the same time.
- **Shared Utilities**: Expose utilities in `src/lib/utils.ts` and imports them directly. Do not re-implement `formatPhTime()` or `getAge()`.

---

## Known System Limitations

Developers must keep these documented limitations in mind:

1. **RAG Text Slicing (`chunkText`)**:
   The chunking function inside `src/app/(dashboard)/admin/rag/actions.ts` uses character-based slicing (`1000` characters length, `200` overlap) rather than sentence-aware boundary detection. This is expected behavior; do not rewrite it without alignment on RAG quality changes.
2. **Chatbot Rate Limit Constant**:
   The `.env.example` file lists `CHAT_RATE_LIMIT_PER_HOUR=20`, but the AI chat handler at `/api/chat` currently uses a hardcoded `20` check against database entries. The env variable is documentation-only.
3. **Specialist Analytics Page Stub**:
   The `/specialist/analytics` page currently triggers a server-side redirect to `/specialist/patients`. Individual patient analytics are instead accessed directly via `/specialist/patients/[patientId]/analytics`. Do not remove this redirect path without team alignment on the analytical metrics implementation.
