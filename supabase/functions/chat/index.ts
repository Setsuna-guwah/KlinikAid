/**
 * Supabase Edge Function: chat
 * Runtime: Deno (Supabase Edge Functions)
 *
 * ============================================================
 * ⚠️  TWO IMPLEMENTATIONS WARNING
 * ============================================================
 * The KlinikAid chatbot pipeline has TWO parallel implementations:
 *
 *   1. Web  → src/app/api/chat/route.ts
 *              (Next.js, Node.js, cookie auth, messages[] body)
 *
 *   2. Mobile → supabase/functions/chat/index.ts   ← THIS FILE
 *              (Deno, JWT Bearer auth, single message body, returns log_id)
 *
 * Any future change to the following MUST be applied to BOTH files:
 *   - Rate limit threshold (currently 20/hour keyed on user_id)
 *   - match_documents RPC arguments (threshold: 0.6, count: 5)
 *   - Model strings (gemini-embedding-001, gemini-2.5-flash)
 *   - System prompt / grounding instruction text
 *   - chatbot_logs insert columns
 *
 * This is a deliberate tradeoff: the mobile client stays within Supabase's
 * API surface (supabase.functions.invoke) without needing the Vercel URL,
 * Bearer token wiring, or response contract changes.
 * ============================================================
 *
 * Request contract (mobile sends):
 *   POST body: { "message": string, "session_id": string }
 *   Header:    Authorization: Bearer <supabase_jwt>
 *
 * Response contract (mobile expects):
 *   200: { "response": string, "log_id": number }
 *   400: { "error": string }
 *   401: { "error": string }
 *   429: { "error": string }
 *   500: { "error": string }
 *
 * Required secrets (set via `supabase secrets set`):
 *   GEMINI_API_KEY — Google Gemini API key
 *   SUPABASE_URL, SUPABASE_ANON_KEY — auto-provided by Supabase runtime
 *
 * Deploy: supabase functions deploy chat
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// CORS headers — required for mobile webviews and future browser callers
// ---------------------------------------------------------------------------
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// ---------------------------------------------------------------------------
// Gemini REST — Embedding
//
// Endpoint (verified against Google official api-examples repo and API ref):
//   POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent
//   Header: x-goog-api-key: {KEY}
//
// Body shape (verified):
//   {
//     "model": "models/gemini-embedding-001",   // note: "models/" prefix required
//     "content": { "parts": [{ "text": "..." }] },
//     "output_dimensionality": 768              // ⚠️ SNAKE_CASE in REST, not camelCase
//   }
//   The Node SDK (@google/generative-ai) converts camelCase outputDimensionality
//   to this snake_case field internally. Using camelCase in raw REST silently
//   ignores the field and returns 3072-dim vectors — which breaks match_documents
//   (expects 768-dim vectors to match rag_documents.embedding vector(768)).
//
// Response shape:
//   { "embedding": { "values": [number, ...] } }
// ---------------------------------------------------------------------------
async function embedText(
  text: string,
  apiKey: string
): Promise<number[] | null> {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text }] },
      output_dimensionality: 768, // snake_case — see comment above
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`Gemini embedding error ${res.status}:`, errBody);
    return null;
  }

  const data = await res.json() as { embedding?: { values?: number[] } };
  return data.embedding?.values ?? null;
}

// ---------------------------------------------------------------------------
// Gemini REST — Generation
//
// Endpoint:
//   POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
//
// Body shape:
//   {
//     "system_instruction": { "parts": [{ "text": "<system prompt>" }] },
//     "contents": [{ "role": "user", "parts": [{ "text": "<message>" }] }]
//   }
//
// Response: candidates[0].content.parts[0].text
//           usageMetadata.totalTokenCount
// ---------------------------------------------------------------------------
async function generateResponse(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<{ text: string; tokensUsed: number }> {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`Gemini generation error ${res.status}:`, errBody);
    throw new Error(`Gemini generation failed with status ${res.status}`);
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    usageMetadata?: { totalTokenCount?: number };
  };

  const text =
    data.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response generated.";
  const tokensUsed = data.usageMetadata?.totalTokenCount ?? 0;

  return { text, tokensUsed };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  // ------------------------------------------------------------------
  // 0. Validate required env vars — fail loudly on misconfiguration
  // ------------------------------------------------------------------
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("FATAL: SUPABASE_URL or SUPABASE_ANON_KEY is not set.");
    return errorResponse("Server configuration error.", 500);
  }
  if (!geminiApiKey) {
    console.error(
      "FATAL: GEMINI_API_KEY is not set. Set it via: supabase secrets set GEMINI_API_KEY=<value>"
    );
    return errorResponse("Server configuration error.", 500);
  }

  // ------------------------------------------------------------------
  // 1. Auth — read JWT from Authorization header, validate via getUser()
  // ------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse("Unauthorized: Missing or invalid Authorization header.", 401);
  }
  const jwt = authHeader.replace("Bearer ", "");

  // Build a Supabase client scoped to this request's JWT
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("Auth error:", authError?.message ?? "No user");
    return errorResponse("Unauthorized: Please sign in to chat.", 401);
  }

  // ------------------------------------------------------------------
  // Pipeline — wrapped in try/catch; full errors logged, sanitized to client
  // ------------------------------------------------------------------
  try {
    // 2. Parse + validate request body
    let body: { message?: unknown; session_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body.", 400);
    }

    const message =
      typeof body.message === "string" ? body.message.trim() : "";
    const sessionId =
      typeof body.session_id === "string" ? body.session_id.trim() : "";

    if (!message) {
      return errorResponse("Field 'message' is required and must be a non-empty string.", 400);
    }
    if (!sessionId) {
      return errorResponse("Field 'session_id' is required and must be a non-empty string.", 400);
    }

    // 3. Rate limit — max 20 requests per hour keyed on user.id
    //    (mirrors web route.ts exactly: count >= 20 threshold, user_id keyed, 1-hour window)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from("chatbot_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", oneHourAgo);

    if (countError) {
      console.error("Rate limit check failed:", countError.message);
      // Non-fatal — allow request to proceed rather than block on monitoring errors
    } else if (count !== null && count >= 20) {
      return errorResponse(
        "Rate limit exceeded. You can only send up to 20 messages per hour.",
        429
      );
    }

    // 4. Generate query embedding via gemini-embedding-001 (768 dimensions)
    //    Note: output_dimensionality must be snake_case in REST — see embedText() comment.
    const queryEmbedding = await embedText(message, geminiApiKey);
    if (!queryEmbedding) {
      return errorResponse("Failed to process query embeddings.", 500);
    }

    // 5. Vector similarity search via match_documents RPC
    //    Mirrors web: match_threshold: 0.6, match_count: 5
    const { data: matchedDocs, error: rpcError } = await supabase.rpc(
      "match_documents",
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.6,
        match_count: 5,
      }
    );

    if (rpcError) {
      console.error("RAG match_documents RPC error:", rpcError.message);
    }

    const docList = (matchedDocs as Array<{
      title: string;
      content: string;
    }> | null) ?? [];

    // 6. Construct RAG context
    const context =
      docList.length > 0
        ? docList
            .map((doc) => `Source: ${doc.title}\nContent: ${doc.content}`)
            .join("\n\n")
        : "No relevant guidelines or clinic documents found.";

    // 7. System prompt — verbatim copy from src/app/api/chat/route.ts
    //    ⚠️ SYNC RULE: If this text changes, update route.ts too (and vice versa).
    const systemPrompt = `You are KlinikAid's 24/7 AI-driven clinic assistant.
Your goal is to answer clinic inquiries, guidelines, schedules, services, requirements, or diagnostic test preparations for patients and visitors of "Bloodcare Medical Laboratory".

You must base your answers ONLY on the provided Clinic Knowledge context. Do not make up information.
If the answer cannot be found in the context, politely state that you can only assist with clinic inquiries and refer them to contact the reception desk or clinical specialists. Do not diagnose conditions or give medical guidance.

Clinic Knowledge context:
${context}`;

    // 8. Generate response via gemini-2.5-flash
    //    Mobile sends a single message (no history); web sends full messages[].
    //    Both reach the same model with the same system prompt — different context window only.
    const { text: botResponse, tokensUsed } = await generateResponse(
      systemPrompt,
      message,
      geminiApiKey
    );

    // 9. Log to chatbot_logs — use .select('id').single() to capture the inserted row id
    //    The log_id is returned to mobile so it can submit per-message feedback
    //    (thumbs up/down → chatbot_logs.feedback). Web does not currently have feedback UI.
    //    Note: column names match the active schema (user_message, not user_query).
    const { data: logRow, error: logError } = await supabase
      .from("chatbot_logs")
      .insert({
        user_id: user.id,
        session_id: sessionId,
        user_message: message,
        bot_response: botResponse,
        tokens_used: tokensUsed,
      })
      .select("id")
      .single();

    if (logError) {
      // Non-fatal: log it server-side but still return the bot response to the user
      console.error("Failed to log chatbot interaction:", logError.message);
    }

    // 10. Return response
    return jsonResponse({
      response: botResponse,
      log_id: logRow?.id ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to process chat request.";
    console.error("Chat Edge Function error:", err);
    return errorResponse(message, 500);
  }
});
