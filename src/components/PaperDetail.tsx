"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MarkdownContent } from "@/components/MarkdownContent";
import type { ChatMessage, Paper, PaperCommunityState } from "@/lib/types";

type Tab = "overview" | "chat" | "notes";

type Props = {
  paper: Paper | null;
  tab: Tab;
  onTabChange: (t: Tab) => void;
  signedIn: boolean;
};

const TABS: Tab[] = ["overview", "chat", "notes"];

export function PaperDetail({ paper, tab, onTabChange, signedIn }: Props) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border bg-surface-2 px-6 py-5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTabChange(t)}
            className={`rounded-md px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] transition-all duration-300 ease-spring ${
              tab === t
                ? "bg-accent text-background"
                : "text-muted hover:bg-white/5 hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {!paper ? (
          <div className="flex h-full items-center justify-center px-6 py-8">
            <div className="max-w-xs rounded-xl border border-border bg-surface-2 px-8 py-10 text-center">
              <p className="font-display text-3xl leading-none tracking-[-0.04em] text-foreground">
                Details wait here
              </p>
              <p className="mt-3 text-sm leading-6 text-muted">
                Select a paper to inspect the abstract, notes, and conversation.
              </p>
            </div>
          </div>
        ) : tab === "overview" ? (
          <article className="space-y-8 overflow-y-auto px-6 py-8">
            <div className="space-y-4">
              <div className="inline-block rounded-full bg-accent-soft px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-accent-soft-foreground">
                Overview
              </div>
              <h3 className="font-display text-4xl leading-[0.95] tracking-[-0.04em] text-foreground">
                <MarkdownContent
                  content={paper.title}
                  className="contents"
                  inline
                />
              </h3>
              <p className="font-mono text-xs text-muted">
                {paper.authors.join(", ") || "Unknown authors"}
              </p>
              <PaperCommunityActions paper={paper} signedIn={signedIn} />
            </div>

            <div className="h-px w-full bg-border" />

            <div className="space-y-4">
              <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                Abstract
              </h4>
              {paper.abstract ? (
                <MarkdownContent
                  content={paper.abstract}
                  className="chat-markdown text-sm leading-7"
                />
              ) : (
                <p className="text-sm italic text-muted">
                  Abstract pending enrichment.
                </p>
              )}
            </div>
          </article>
        ) : tab === "chat" ? (
          <ChatPanel paper={paper} signedIn={signedIn} />
        ) : (
          <div className="flex h-full items-center justify-center px-6 py-8">
            <p className="text-sm text-muted">
              Notes editor will mount here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PaperCommunityActions({
  paper,
  signedIn,
}: {
  paper: Paper;
  signedIn: boolean;
}) {
  const [state, setState] = useState<PaperCommunityState | null>(null);
  const [saving, setSaving] = useState<"star" | "claim" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setState(null);
      return;
    }

    const controller = new AbortController();
    setError(null);

    (async () => {
      try {
        const response = await fetch(
          `/api/papers/${encodeURIComponent(paper.id)}/star`,
          {
            signal: controller.signal,
          },
        );
        const payload = (await response.json()) as {
          state?: PaperCommunityState;
          error?: string;
        };

        if (!response.ok || !payload.state) {
          throw new Error(payload.error ?? "Failed to load community state");
        }

        setState(payload.state);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load community state",
        );
      }
    })();

    return () => controller.abort();
  }, [paper.id, signedIn]);

  const update = async (kind: "star" | "claim") => {
    if (!signedIn || !state || saving) return;

    const active = kind === "star" ? state.starred : state.claimed;
    setSaving(kind);
    setError(null);

    try {
      const response = await fetch(
        `/api/papers/${encodeURIComponent(paper.id)}/${kind}`,
        {
          method: active ? "DELETE" : "PUT",
        },
      );
      const payload = (await response.json()) as {
        state?: PaperCommunityState;
        error?: string;
      };

      if (!response.ok || !payload.state) {
        throw new Error(payload.error ?? `Failed to update ${kind}`);
      }

      setState(payload.state);
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : `Failed to update ${kind}`,
      );
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void update("star")}
        disabled={!signedIn || !state || saving !== null}
        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all duration-300 ease-spring active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
          state?.starred
            ? "border-accent bg-accent text-background"
            : "border-border bg-surface-2 text-muted hover:text-foreground"
        }`}
      >
        {saving === "star" ? "Saving" : state?.starred ? "Starred" : "Star"}{" "}
        {state?.star_count ?? paper.star_count ?? 0}
      </button>
      <button
        type="button"
        onClick={() => void update("claim")}
        disabled={
          !signedIn || !state || !state.can_claim || saving !== null
        }
        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all duration-300 ease-spring active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
          state?.claimed
            ? "border-accent bg-accent text-background"
            : "border-border bg-surface-2 text-muted hover:text-foreground"
        }`}
        title={state && !state.can_claim ? "Verified profile required" : undefined}
      >
        {saving === "claim" ? "Saving" : state?.claimed ? "Claimed" : "Claim"}{" "}
        {state?.claim_count ?? paper.claimed_by_count ?? 0}
      </button>
      {error ? <p className="basis-full text-xs text-[#e3bb74]">{error}</p> : null}
    </div>
  );
}

type ChatPanelProps = {
  paper: Paper;
  signedIn: boolean;
};

type PendingMessage = {
  id: "pending-user";
  role: "user";
  content: string;
};

function ChatPanel({ paper, signedIn }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [streaming, setStreaming] = useState<string>("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setMessages([]);
      setError("Sign in required");
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setMessages([]);
    setPending(null);
    setStreaming("");

    (async () => {
      try {
        const response = await fetch(
          `/api/papers/${encodeURIComponent(paper.id)}/chat`,
          {
            signal: controller.signal,
          },
        );
        const body = (await response.json()) as {
          messages?: ChatMessage[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "Failed to load chat");
        }
        setMessages(body.messages ?? []);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load chat",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [paper.id, signedIn]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming, pending]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    if (!signedIn) {
      setError("Sign in required");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    setError(null);
    setPending({ id: "pending-user", role: "user", content: trimmed });
    setStreaming("");
    setInput("");

    try {
      const response = await fetch(
        `/api/papers/${encodeURIComponent(paper.id)}/chat`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: trimmed }),
        },
      );

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          detail.slice(0, 200) || `Chat failed (${response.status})`,
        );
      }

      let buffered = "";
      let streamed = "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });

        let boundary: number;
        while ((boundary = buffered.indexOf("\n\n")) !== -1) {
          const rawEvent = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          const evt = parseSseEvent(rawEvent);
          if (!evt) continue;

          if (evt.event === "user_message") {
            const msg = evt.data as ChatMessage;
            setMessages((prev) => [...prev, msg]);
            setPending(null);
          } else if (evt.event === "delta") {
            const delta = (evt.data as { content?: string }).content ?? "";
            streamed += delta;
            setStreaming(streamed);
          } else if (evt.event === "assistant_message") {
            const msg = evt.data as ChatMessage;
            setMessages((prev) => [...prev, msg]);
            setStreaming("");
          } else if (evt.event === "error") {
            const message =
              (evt.data as { message?: string }).message ?? "Chat error";
            throw new Error(message);
          }
        }
      }
    } catch (sendError) {
      if (controller.signal.aborted) return;
      setError(
        sendError instanceof Error ? sendError.message : "Chat failed",
      );
      setPending(null);
      setStreaming("");
    } finally {
      if (!controller.signal.aborted) {
        setSending(false);
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const isEmpty =
    !loading &&
    messages.length === 0 &&
    !pending &&
    !streaming &&
    !error;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="flex-1 space-y-5 overflow-y-auto px-6 py-6"
      >
        {loading ? (
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Loading conversation…
          </p>
        ) : isEmpty ? (
          <div className="rounded-xl border border-border bg-surface-2 px-5 py-6">
            <p className="font-display text-2xl leading-none tracking-[-0.04em] text-foreground">
              Ask anything
            </p>
            <p className="mt-3 text-sm leading-6 text-muted">
              Carbon answers with the paper text, summary, BS score, and your
              wider library in context. Cite sources with [paper] and
              [lib:&nbsp;title].
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {pending ? <MessageBubble message={pending} /> : null}
        {streaming ? (
          <MessageBubble
            message={{
              id: "streaming",
              role: "assistant",
              content: streaming,
            }}
            streaming
          />
        ) : null}
        {error ? (
          <p className="rounded-md border border-[#5a3434] bg-[#2a1818] px-4 py-3 font-mono text-xs text-[#e3bb74]">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="border-t border-border bg-surface-2 px-4 py-4">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              signedIn
                ? "Ask about this paper…"
                : "Sign in to chat"
            }
            disabled={!signedIn || sending}
            className="min-h-[40px] max-h-40 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!signedIn || sending || input.trim().length === 0}
            className="h-10 rounded-md bg-accent px-4 text-xs font-bold uppercase tracking-[0.18em] text-background transition-all duration-300 ease-spring hover:bg-[#ddd7cb] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      </footer>
    </div>
  );
}

type MessageLike = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

function MessageBubble({
  message,
  streaming,
}: {
  message: MessageLike;
  streaming?: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-6 ${
          isUser
            ? "bg-accent text-background"
            : "border border-border bg-surface-2 text-foreground"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <MarkdownContent content={message.content} streaming={streaming} />
        )}
      </div>
    </div>
  );
}

type SseEvent = { event?: string; data: unknown };

function parseSseEvent(raw: string): SseEvent | null {
  const lines = raw.split("\n");
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const joined = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(joined) };
  } catch {
    return { event, data: joined };
  }
}
