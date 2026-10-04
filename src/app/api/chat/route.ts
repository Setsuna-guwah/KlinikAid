import { createClient } from "@/lib/supabase/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { GoogleGenerativeAI } from "@google/generative-ai";
import crypto from "crypto";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

type EmbedContentFn = (req: {
  content: { role: string; parts: Array<{ text: string }> };
  outputDimensionality: number;
}) => Promise<{ embedding: { values: number[] } }>;

interface ChatMessage {
  role: "user" | "model";
  content: string;
}

interface MatchedDocument {
  id: string;
  title: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

export async function POST(request: Request) {
  // 1. Session first (Standing Rule #1)
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return errorResponse("Unauthorized: Please sign in to chat.", 401);
  }

  try {
    const body = await request.json();
    const { messages, sessionId } = body as { messages: ChatMessage[]; sessionId?: string };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return errorResponse("Messages history is required.");
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "user" || !lastMessage.content) {
      return errorResponse("The last message must be a user message with content.");
    }

    const userQuery = lastMessage.content;
    const activeSessionId = sessionId || crypto.randomUUID();

    // 2. Enforce Rate Limit: Max 20 requests per hour keyed off authenticated user.id (prevents sessionId bypasses)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from("chatbot_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", oneHourAgo);

    if (countError) {
      console.error("Failed to fetch message count for rate limiting:", countError);
    } else if (count !== null && count >= 20) {
      return errorResponse("Rate limit exceeded. You can only send up to 20 messages per hour.", 429);
    }

    // 3. Generate query embedding via gemini-embedding-001 (768 dimensions)
    // Note: text-embedding-004 is requested by spec, but returned 404 in this environment's Gemini API.
    // We use gemini-embedding-001 with outputDimensionality: 768 to achieve the correct 768-dim vector size.
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const embedResult = await (embeddingModel.embedContent as unknown as EmbedContentFn)({
      content: { role: "user", parts: [{ text: userQuery }] },
      outputDimensionality: 768,
    });
    const queryEmbedding = embedResult.embedding?.values;

    if (!queryEmbedding) {
      return errorResponse("Failed to process query embeddings.");
    }

    // 4. Perform vector similarity search in public.rag_documents
    const { data: matchedDocs, error: rpcError } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.6,
      match_count: 5,
    });

    if (rpcError) {
      console.error("RAG match_documents RPC error:", rpcError);
    }

    const matchedDocsList = (matchedDocs as unknown as MatchedDocument[]) || [];

    // 5. Construct RAG context
    const context = matchedDocsList.length > 0
      ? matchedDocsList.map((doc) => `Source: ${doc.title}\nContent: ${doc.content}`).join("\n\n")
      : "No relevant guidelines or clinic documents found.";

    // 6. Call Gemini 1.5 Flash with System Grounding
    const systemPrompt = `You are KlinikAid's 24/7 AI-driven clinic assistant.
Your goal is to answer clinic inquiries, guidelines, schedules, services, requirements, or diagnostic test preparations for patients and visitors of "Bloodcare Medical Laboratory".

You must base your answers ONLY on the provided Clinic Knowledge context. Do not make up information.
If the answer cannot be found in the context, politely state that you can only assist with clinic inquiries and refer them to contact the reception desk or clinical specialists. Do not diagnose conditions or give medical guidance.

Clinic Knowledge context:
${context}`;

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
    const chatResult = await chatSession.sendMessage(userQuery);
    const botResponse = chatResult.response.text();
    const tokensUsed = chatResult.response.usageMetadata?.totalTokenCount || 0;

    // 7. Log interaction in public.chatbot_logs
    // Note: Although guide mentions user_query, the active Supabase schema uses the user_message column.
    const { error: logError } = await supabase.from("chatbot_logs").insert({
      user_id: user.id,
      session_id: activeSessionId,
      user_message: userQuery,
      bot_response: botResponse,
      tokens_used: tokensUsed,
    });

    if (logError) {
      console.error("Failed to log chatbot interaction:", logError);
    }

    return successResponse({
      response: botResponse,
      tokensUsed,
    });
  } catch (err) {
    console.error("Chat API error:", err);
    const message = err instanceof Error ? err.message : "Failed to process chat request.";
    return errorResponse(message, 500);
  }
}
