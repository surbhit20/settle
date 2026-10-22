"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatReply, ViewState } from "@/lib/agent/types";
import type { ScoreRequest } from "@/lib/scoring/request";

type Message = { role: "user" | "assistant"; text: string };

type Props = {
  request: ScoreRequest; // the user's current inputs, sent with every message
  onReply: (reply: ChatReply) => void; // Explorer applies the actions (rescore, select areas)
  view: ViewState; // what's on screen (open area, compared areas), sent so "it" and "this" make sense
  viewLabel: string | null; // e.g. "Los Altos 94022", shown on the minimized banner
};

const EXAMPLES = ["What if my budget goes up 300?", "I care more about safety", "Why is Milpitas ranked low?"];

// A chat window docked to the bottom-right edge of the screen (position: fixed), so it stays put
// while the page scrolls. Explorer shows it only after the first search. It can be minimized to a
// banner but never closed. Messages survive minimizing: the state lives in this component.
export default function ChatBox({ request, onReply, view, viewLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest message in view, including right after the window is reopened.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  // Put the cursor in the input when the window opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(message: string) {
    if (!message.trim() || sending) return;
    setMessages((m) => [...m, { role: "user", text: message }]);
    setText("");
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, request, view }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const reply = body as ChatReply;
      setMessages((m) => [...m, { role: "assistant", text: reply.reply }]);
      onReply(reply);
    } catch (e) {
      // The server already sends a readable message; fall back to a generic one for network errors.
      const msg = (e as Error).message;
      setMessages((m) => [...m, { role: "assistant", text: msg.startsWith("Sorry") ? msg : "Sorry, I couldn't reach the server. Please try again." }]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(text);
  }

  // Minimized: a banner docked to the bottom edge, the same width as the open window.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${DOCK} flex items-center gap-3 rounded-t-2xl border border-b-0 border-line bg-paper px-5 py-3.5 text-left shadow-2xl transition hover:bg-surface`}
        aria-label="Open the chat"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
          <ChatIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-lg leading-tight">Ask or adjust</span>
          <span className="block truncate text-xs text-muted">
            {sending ? "Thinking…" : viewLabel ? `About ${viewLabel}` : "What if my budget goes up 300?"}
          </span>
        </span>
        <ChevronUp />
      </button>
    );
  }

  return (
    <section
      aria-label="Chat"
      // Width: 24rem, or the screen minus margins on phones. Height: grows with the messages up to
      // 36rem, never taller than the screen.
      className={`${DOCK} flex max-h-[min(36rem,calc(100dvh-2rem))] flex-col overflow-hidden rounded-t-3xl border border-b-0 border-line bg-paper shadow-2xl`}
    >
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div>
          <h2 className="font-serif text-xl leading-none">Ask or adjust</h2>
          <p className="mt-1 text-xs text-muted">Change filters or ask why an area ranks where it does.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-sunken hover:text-ink"
          aria-label="Minimize the chat"
          title="Minimize"
        >
          <ChevronDown />
        </button>
      </header>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 text-sm leading-relaxed">
        {messages.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => send(ex)}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink"
              >
                {ex}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-accent-ink"
                  : "rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2.5"
              }
            >
              {m.text}
            </div>
          ))
        )}
        {sending && <div className="text-xs text-muted">Thinking…</div>}
      </div>

      <div className="border-t border-line px-4 pb-4 pt-3">
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 rounded-full border border-line bg-surface p-1.5 pl-4 transition focus-within:border-accent"
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. what if my budget goes up 300?"
            maxLength={500}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </section>
  );
}

// Docked to the bottom edge, 1rem from the right; 24rem wide, or the screen minus margins on phones.
const DOCK = "fixed bottom-0 right-4 z-50 w-[min(24rem,calc(100vw-2rem))]";

function ChevronUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-muted" aria-hidden="true">
      <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
