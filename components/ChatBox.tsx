"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatReply } from "@/lib/agent/types";
import type { ScoreRequest } from "@/lib/scoring/request";

type Message = { role: "user" | "assistant"; text: string; route?: ChatReply["route"]; latencyMs?: number };

type Props = {
  request: ScoreRequest; // the user's current inputs, sent with every message
  onReply: (reply: ChatReply) => void; // Explorer applies the actions (rescore, select areas)
};

const EXAMPLES = ["What if my budget goes up 300?", "I care more about safety", "Why is Milpitas ranked low?"];

export default function ChatBox({ request, onReply }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function send(message: string) {
    if (!message.trim() || sending) return;
    setMessages((m) => [...m, { role: "user", text: message }]);
    setText("");
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, request }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const reply = body as ChatReply;
      setMessages((m) => [...m, { role: "assistant", text: reply.reply, route: reply.route, latencyMs: reply.latencyMs }]);
      onReply(reply);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: `Sorry, that didn't work: ${(e as Error).message}` }]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(text);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <h2 className="text-sm font-semibold">Ask or adjust</h2>
      {messages.length === 0 ? (
        <div className="flex flex-wrap gap-1">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => send(ex)}
              className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {ex}
            </button>
          ))}
        </div>
      ) : (
        <div ref={listRef} className="flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "self-end rounded-lg bg-emerald-700 px-2 py-1 text-white" : ""}>
              {m.text}
              {m.route && (
                // Shows whether the fast path (no LLM) or Claude answered, and how long it took.
                <div className="text-[10px] text-zinc-500">
                  {m.route === "jev" ? "instant (no AI text generation)" : "answered by Claude"} · {(m.latencyMs! / 1000).toFixed(1)}s
                </div>
              )}
            </div>
          ))}
          {sending && <div className="text-xs text-zinc-500">Thinking…</div>}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. what if my budget goes up 300?"
          maxLength={500}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="rounded-md bg-emerald-700 px-3 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
