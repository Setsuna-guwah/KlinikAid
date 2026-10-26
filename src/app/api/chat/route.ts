import { createClient } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/api-response";
import { validateChatMessages } from "@/lib/chat/validate-messages";
import { streamModelReply } from "@/lib/chat/reply-stream";
import { classifyRead, readErrors } from "@/lib/read-outcome";
import { timed } from "@/lib/perf/timing";
import {
  checkPrivacyConsent,
  PRIVACY_CONSENT_CHECK_FAILED_MESSAGE,
  PRIVACY_CONSENT_REQUIRED_MESSAGE,
} from "@/lib/auth/privacy-consent";
import {
  buildQueryAnalysisPrompt,
  buildSystemPrompt,
  parseQueryAnalysis,
  type QueryAnalysis,
} from "@/lib/chat/query-language";
import {
  buildRetrievalQueries,
  mergeMatchLists,
  RETRIEVAL_MATCH_COUNT,
  RETRIEVAL_MATCH_THRESHOLD,
  RETRIEVAL_TOP_K,
  type RetrievalMatch,
} from "@/lib/chat/retrieval";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { after } from "next/server";
import crypto from "crypto";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * Messages this user sent in the last hour, for the 20-per-hour limit. Returns
 * the query so the caller can run it alongside the consent check.
 */
function countRecentMessages(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return supabase
    .from("chatbot_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);
}

type EmbedContentFn = (req: {
  content: { role: string; parts: Array<{ text: string }> };
  outputDimensionality: number;
}) => Promise<{ embedding: { values: number[] } }>;

/**
 * Render the question in English for retrieval and detect the reply language
 * (#73 item 9). The knowledge base is English-only, and embedding a Filipino
 * question demotes the document that answers it below the match_count cutoff
 * (the operating-hours doc ranks 3rd for the English wording, 10th for the
 * Filipino one), which the model then answered with the out-of-scope decline.
 * A failure here must not fail the chat: the original question is embedded
 * instead and the reply language falls back to mirroring the patient.
 */
async function analyseQuery(userQuery: string): Promise<QueryAnalysis> {
  try {
    const analysisModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await analysisModel.generateContent(buildQueryAnalysisPrompt(userQuery));
    return parseQueryAnalysis(result.response.text(), userQuery);
  } catch (err) {
    console.error("Query language analysis failed; retrieving with the original question:", err);
    return parseQueryAnalysis("", userQuery);
  }
}

/**
 * One patient chat turn: session, consent, rate limit, multi-query
 * English-rendered retrieval, language-matched reply, and the `chatbot_logs`
 * audit row. The reply streams back as NDJSON frames (see `chat/reply-stream.ts`);
 * the audit row is written after the reply completes.
 */
export async function POST(request: Request) {
  // 1. Session first (Standing Rule #1)
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return errorResponse("Unauthorized: Please sign in to chat.", 401);
  }

  // Consent gate (RA 10173): before the message reaches Gemini or chatbot_logs.
  // The rate-limit count is an independent read, so it runs alongside the gate
  // and is only acted on once the gate has passed and the body is valid.
  const [consent, recentMessages] = await timed("chat: consent + rate-limit count", () =>
    Promise.all([checkPrivacyConsent(supabase, user.id), countRecentMessages(supabase, user.id)])
  );
  if (consent.kind === "failed") {
    return errorResponse(PRIVACY_CONSENT_CHECK_FAILED_MESSAGE, 503, consent.error);
  }
  if (consent.kind === "not_accepted") {
    return errorResponse(PRIVACY_CONSENT_REQUIRED_MESSAGE, 403);
  }

  try {
    const body = await request.json();
    const { messages: rawMessages, sessionId } = (body ?? {}) as { messages?: unknown; sessionId?: string };

    // Bound what reaches the model: the input box caps length, a direct request does not.
    const checked = validateChatMessages(rawMessages);
    if (!checked.valid) {
      return errorResponse(checked.error);
    }
    const { messages, userQuery } = checked;
    const activeSessionId = sessionId || crypto.randomUUID();

    // 2. Enforce Rate Limit: Max 20 requests per hour keyed off authenticated user.id (prevents sessionId bypasses)
    const { count, error: countError } = recentMessages;

    if (countError) {
      console.error("Failed to fetch message count for rate limiting:", countError);
    } else if (count !== null && count >= 20) {
      return errorResponse("Rate limit exceeded. You can only send up to 20 messages per hour.", 429);
    }

    // 3. Language analysis for the reply + English retrieval variants (#73 item 9, #150)
    const analysis = await timed("chat: language analysis", () => analyseQuery(userQuery));

    // 4. Embed every retrieval variant via gemini-embedding-001 (768 dimensions)
    //
    // One embedding is phrasing-dependent (#150): the literal question "What are
    // Bloodcare Medical Laboratory's operating hours?" renders correctly in
    // English and still lands the answering doc below the 0.6 threshold, so the
    // assistant declined. The patient's own words, the English rendering and
    // 1-2 model-generated paraphrases are therefore embedded in parallel and
    // their result lists unioned -- one well-matching phrasing is enough.
    // Everything the patient sees still flows through their own words: history
    // in their language, reply in it, and `chatbot_logs` stores their own words.
    // Note: text-embedding-004 is requested by spec, but returned 404 in this environment's Gemini API.
    // We use gemini-embedding-001 with outputDimensionality: 768 to achieve the correct 768-dim vector size.
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const retrievalQueries = buildRetrievalQueries(userQuery, analysis);
    const embedded = await timed("chat: embed retrieval queries", () =>
      Promise.allSettled(
        retrievalQueries.map((query) =>
          (embeddingModel.embedContent as unknown as EmbedContentFn)({
            content: { role: "user", parts: [{ text: query }] },
            outputDimensionality: 768,
          })
        )
      )
    );
    const queryEmbeddings = embedded
      .map((result) => (result.status === "fulfilled" ? result.value.embedding?.values : undefined))
      .filter((values): values is number[] => Array.isArray(values) && values.length > 0);

    // All variants failed to embed: there is no query to search with. A partial
    // failure degrades to fewer phrasings, which is the recall the fix exists
    // for, not a reason to fail the whole turn.
    if (queryEmbeddings.length === 0) {
      if (embedded.some((result) => result.status === "rejected")) {
        console.error("All retrieval query embeddings failed:", embedded);
      }
      return errorResponse("Failed to process query embeddings.");
    }

    // 5. Perform vector similarity search in public.rag_documents, once per embedding
    //
    // A failed search must not become an answer. The previous `|| []` made
    // "the vector index was unreachable" and "the knowledge base has nothing on
    // this" produce the same grounding string, and the model was then instructed
    // to answer *only* from it -- so a broken index returned a fluent, confident
    // 200 asserting the clinic has no information, indistinguishable from a
    // genuine gap in the documents. Absence of evidence and failure to look are
    // separated here, once, so no caller downstream has to.
    const searches = await timed("chat: match_documents", () =>
      Promise.allSettled(
        queryEmbeddings.map((queryEmbedding) =>
          supabase.rpc("match_documents", {
            query_embedding: queryEmbedding,
            // Threshold and counts: see the tuning rationale in chat/retrieval.ts
            // (#150). 0.45, not the pre-#150 0.6: several answering documents
            // never reach 0.6 in any phrasing (measured 0.467-0.573), so the
            // assistant declined questions it could answer. RETRIEVAL_MATCH_COUNT
            // (15, the corpus's size) gives the union the full above-threshold
            // set per query -- a document at rank 9 never reaches the merge at a
            // lower count -- and the merge below cuts the union to RETRIEVAL_TOP_K.
            match_threshold: RETRIEVAL_MATCH_THRESHOLD,
            match_count: RETRIEVAL_MATCH_COUNT,
          })
        )
      )
    );
    const outcomes = searches.map((result) =>
      result.status === "fulfilled"
        ? classifyRead(result.value)
        : { kind: "failed" as const, error: result.reason }
    );

    const failures = readErrors(outcomes);
    if (failures.length === outcomes.length) {
      console.error("RAG match_documents RPC error:", failures);
      // 503, not 200: the assistant genuinely could not answer, and a patient
      // told "we have no information" may act on that. The chat UI surfaces the
      // message, which points them at a human who can actually check.
      return errorResponse(
        "The clinic assistant is temporarily unavailable because its document search could not be reached. Please contact the reception desk.",
        503
      );
    }
    if (failures.length > 0) {
      // Some phrasings failed to search; the turn continues on the rest.
      console.error(
        `RAG match_documents partial failure: ${failures.length} of ${outcomes.length} queries failed:`,
        failures
      );
    }

    const matchedDocsList = mergeMatchLists(
      outcomes.flatMap((outcome) =>
        outcome.kind === "ok" ? [((outcome.data ?? []) as unknown as RetrievalMatch[])] : []
      ),
      RETRIEVAL_TOP_K
    );

    // 6. Construct RAG context
    const context = matchedDocsList.length > 0
      ? matchedDocsList.map((doc) => `Source: ${doc.title}\nContent: ${doc.content}`).join("\n\n")
      : "No relevant guidelines or clinic documents found.";

    // 7. Call Gemini 2.5 Flash with System Grounding, answered in the patient's language
    const systemPrompt = buildSystemPrompt(context, analysis.language);

    const chatModel = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    // Format history for Google Generative AI chat
    const rawHistory = messages.slice(0, -1).map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    // Gemini requires history to start with a user turn.
    // The client initializes with a model greeting which must be stripped.
    const firstUserIndex = rawHistory.findIndex((m) => m.role === "user");
    const history = firstUserIndex >= 0 ? rawHistory.slice(firstUserIndex) : [];

    const chatSession = chatModel.startChat({ history });
    // Streamed so the first words reach the patient as soon as Gemini produces
    // them. A failure before the stream starts still throws to the catch below
    // and returns a JSON error; a failure after it is an error frame.
    const chatResult = await timed("chat: start reply stream", () => chatSession.sendMessageStream(userQuery));
    const { body: replyStream, reply } = streamModelReply(chatResult);

    // 8. Log interaction in public.chatbot_logs (unchanged: the patient's own words, not the English rendering).
    // Written after the response, once the reply is complete. A reply that failed
    // part-way has no row, as before: only a completed answer is logged.
    // Note: Although guide mentions user_query, the active Supabase schema uses the user_message column.
    after(async () => {
      const completed = await reply;
      if (!completed) return;

      const { error: logError } = await supabase.from("chatbot_logs").insert({
        user_id: user.id,
        session_id: activeSessionId,
        user_message: userQuery,
        bot_response: completed.text,
        tokens_used: completed.tokensUsed,
      });

      if (logError) {
        // The conversation is the audit record of what the assistant told a
        // patient. Swallowing this means a clinically-relevant exchange can vanish
        // from /admin/logs with nothing to indicate it happened. The answer to the
        // patient is still returned -- the log write failing does not make the
        // reply wrong -- but it is raised on the server so it is not silent.
        console.error("Failed to log chatbot interaction:", logError);
      }
    });

    return new Response(replyStream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Chat API error:", err);
    const message = err instanceof Error ? err.message : "Failed to process chat request.";
    return errorResponse(message, 500);
  }
}
