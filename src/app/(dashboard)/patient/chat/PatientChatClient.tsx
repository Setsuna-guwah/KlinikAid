"use client";

import React, { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Bot, Send, User, Loader2, ShieldAlert } from "lucide-react";

interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export default function PatientChatClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "model",
      content: "Hello! I am your KlinikAid AI assistant. How can I help you today with laboratory schedules, services, test preparations, or general inquiries?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Generate simple random session ID on client mount
    setSessionId(`sess_${Math.random().toString(36).substring(2, 11)}`);
  }, []);

  useEffect(() => {
    if (!rateLimitedUntil) return;
    const interval = setInterval(() => {
      if (Date.now() >= rateLimitedUntil) {
        setIsRateLimited(false);
        setRateLimitedUntil(null);
        setError(null);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [rateLimitedUntil]);

  useEffect(() => {
    // Scroll to bottom on message updates
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  const handleSend = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading || isRateLimited) return;

    const userMessage = input.trim();
    setInput("");
    setError(null);

    // Append user message immediately
    const updatedMessages = [...messages, { role: "user" as const, content: userMessage }];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: updatedMessages,
          sessionId,
        }),
      });

      if (response.status === 429) {
        setIsRateLimited(true);
        setRateLimitedUntil(Date.now() + 60 * 60 * 1000); // 1 hour from now
        setError("Inquiry limit reached. You have sent the maximum of 20 messages this hour. Please try again in approximately 1 hour.");
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to fetch response from assistant.");
      }

      const resData = await response.json();
      if (resData.success && resData.data?.response) {
        setMessages((prev) => [...prev, { role: "model", content: resData.data.response }]);
      } else {
        throw new Error("Invalid response format received from assistant.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="flex flex-col h-[calc(100vh-12rem)] border border-slate-200/80 dark:border-slate-800 shadow-lg">
      <CardHeader className="flex flex-row items-center gap-4 bg-slate-50/55 dark:bg-slate-900/30 border-b border-slate-100 dark:border-slate-800/80 py-4">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accentBlue-100 text-accentBlue-600 dark:bg-accentBlue-950/30 dark:text-accentBlue-400">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <CardTitle>RAG Inquiry Assistant</CardTitle>
          <CardDescription>Ask about clinical schedules, preparations, and requirements</CardDescription>
        </div>
      </CardHeader>

      {/* Messages Area */}
      <CardContent className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex items-start gap-3 ${
              msg.role === "user" ? "flex-row-reverse" : "flex-row"
            }`}
          >
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${
                msg.role === "user"
                  ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
                  : "bg-accentBlue-100 text-accentBlue-600 dark:bg-accentBlue-950/40 dark:text-accentBlue-400"
              }`}
            >
              {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>

            <div
              className={`p-3.5 rounded-2xl max-w-[75%] text-sm leading-relaxed shadow-sm ${
                msg.role === "user"
                  ? "bg-accentBlue-600 text-white rounded-tr-none"
                  : "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200 rounded-tl-none border border-slate-200/40 dark:border-slate-800/40"
              }`}
            >
              <p className="whitespace-pre-line">{msg.content}</p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accentBlue-100 text-accentBlue-600 dark:bg-accentBlue-950/40 dark:text-accentBlue-400 shrink-0">
              <Bot className="h-4 w-4" />
            </div>
            <div className="p-3.5 rounded-2xl rounded-tl-none bg-slate-100 dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/40 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-accentBlue-600" />
              <span className="text-xs text-slate-500">AI is reading guidelines...</span>
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50 mt-4">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>{isRateLimited ? "Inquiry Limit Reached" : "Chat Error"}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div ref={scrollRef} />
      </CardContent>

      {/* Input Form */}
      <CardFooter className="border-t border-slate-100 dark:border-slate-800/80 p-4 bg-white/50 dark:bg-slate-900/10">
        <form onSubmit={handleSend} className="flex w-full items-center gap-2">
          <Input
            placeholder={
              isRateLimited
                ? "Inquiry limit reached. Please try again later."
                : "Ask about operating hours, test preparations..."
            }
            className="flex-1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading || isRateLimited}
            maxLength={1000}
            required
          />
          <Button
            type="submit"
            size="icon"
            className="bg-accentBlue-600 hover:bg-accentBlue-700 text-white shrink-0 shadow-md shadow-accentBlue-500/10"
            disabled={isLoading || isRateLimited || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
