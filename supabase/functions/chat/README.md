# Supabase Edge Function: `chat`

Mobile chatbot endpoint for KlinikAid. Called by the Flutter client via `supabase.functions.invoke('chat', ...)`.

---

## ⚠️ TWO IMPLEMENTATIONS WARNING

The KlinikAid chatbot pipeline has **two parallel implementations** that must be kept in sync:

| | Web | Mobile |
|---|---|---|
| **File** | `src/app/api/chat/route.ts` | `supabase/functions/chat/index.ts` |
| **Runtime** | Next.js / Node.js | Deno (Supabase Edge Functions) |
| **Auth** | Cookie session | JWT Bearer |
| **Payload** | `{ messages: [...], sessionId }` | `{ message: string, session_id: string }` |
| **Response** | `{ response, tokensUsed }` | `{ response, log_id }` |

**Any change to the following MUST be applied to BOTH files:**
- Rate limit threshold (20/hour keyed on `user_id`)
- `match_documents` RPC arguments (`match_threshold: 0.6`, `match_count: 5`)
- Model strings (`gemini-embedding-001`, `gemini-2.5-flash`)
- System prompt / grounding instruction text
- `chatbot_logs` insert columns

---

## Request Contract

```
POST /functions/v1/chat
Authorization: Bearer <supabase_jwt>
Content-Type: application/json

{
  "message": "string — the user's question",
  "session_id": "string — client-generated UUID for session grouping"
}
```

## Response Contract

```json
// 200 OK
{ "response": "string — bot answer", "log_id": 42 }

// 400 Bad Request
{ "error": "Field 'message' is required..." }

// 401 Unauthorized
{ "error": "Unauthorized: Please sign in to chat." }

// 429 Too Many Requests
{ "error": "Rate limit exceeded. You can only send up to 20 messages per hour." }

// 500 Internal Server Error
{ "error": "Server configuration error." }
```

## Auth Model

Uses Supabase JWT Bearer auth. The Flutter client passes the active session token via `supabase.functions.invoke` automatically. The function calls `supabase.auth.getUser()` to validate the token and identify the caller. No anonymous access.

## Required Environment Variables / Secrets

| Variable | Source | Notes |
|---|---|---|
| `SUPABASE_URL` | Auto-provided by Supabase runtime | Do not set manually |
| `SUPABASE_ANON_KEY` | Auto-provided by Supabase runtime | Do not set manually |
| `GEMINI_API_KEY` | **Must be set manually** | Google AI Studio API key |

Set the Gemini API key before deploying:
```bash
supabase secrets set GEMINI_API_KEY=<your_key_here>
```

## Deploy

```bash
supabase functions deploy chat
```

## Pipeline Summary

1. Validate JWT → `getUser()` → 401 if invalid
2. Validate `message` + `session_id` fields → 400 if missing/empty
3. Rate limit: count `chatbot_logs` rows for `user_id` in last hour → 429 if ≥ 20
4. Embed `message` via `gemini-embedding-001` REST API (768 dimensions)
5. Call `match_documents` RPC (threshold `0.6`, count `5`) → build RAG context
6. Build system prompt (same text as web, verbatim)
7. Generate response via `gemini-2.5-flash` REST API
8. Insert row into `chatbot_logs` → capture `id` as `log_id`
9. Return `{ response, log_id }`

## Embedding REST Note

The Gemini embedding REST API uses `output_dimensionality` (snake_case) as a top-level body field. The Node SDK used by the web implementation converts camelCase internally. Using the wrong casing in raw REST silently returns 3072-dim vectors, which breaks `match_documents` (expects 768-dim). The function uses the correct snake_case field.
