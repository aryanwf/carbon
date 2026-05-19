"use client";

import katex from "katex";
import type { Paper } from "@/lib/types";

type Tab = "overview" | "chat" | "notes";

type Props = {
  paper: Paper | null;
  tab: Tab;
  onTabChange: (t: Tab) => void;
};

const TABS: Tab[] = ["overview", "chat", "notes"];

export function PaperDetail({ paper, tab, onTabChange }: Props) {
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

      <div className="flex-1 overflow-y-auto px-6 py-8">
        {!paper ? (
          <div className="flex h-full items-center justify-center">
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
          <article className="space-y-8">
            <div className="space-y-4">
              <div className="inline-block rounded-full bg-accent-soft px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-accent-soft-foreground">
                Overview
              </div>
              <h3 className="font-display text-4xl leading-[0.95] tracking-[-0.04em] text-foreground">
                {paper.title}
              </h3>
              <p className="font-mono text-xs text-muted">
                {paper.authors.join(", ") || "Unknown authors"}
              </p>
            </div>

            <div className="h-px w-full bg-border" />

            <div className="space-y-4">
              <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                Abstract
              </h4>
              {paper.abstract ? (
                <p className="text-sm leading-7 text-foreground">
                  <LatexText text={paper.abstract} />
                </p>
              ) : (
                <p className="text-sm italic text-muted">
                  Abstract pending enrichment.
                </p>
              )}
            </div>
          </article>
        ) : tab === "chat" ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted">AI chat will mount here.</p>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted">
              Notes editor will mount here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

type LatexPart =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string; displayMode: boolean };

function LatexText({ text }: { text: string }) {
  return parseLatexText(text).map((part, index) => {
    if (part.kind === "text") {
      return <span key={index}>{part.value}</span>;
    }

    try {
      return (
        <span
          key={index}
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(part.value, {
              displayMode: part.displayMode,
              throwOnError: false,
              strict: false,
            }),
          }}
        />
      );
    } catch {
      return <span key={index}>{part.value}</span>;
    }
  });
}

function parseLatexText(text: string) {
  const parts: LatexPart[] = [];
  const pattern = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ kind: "text", value: text.slice(lastIndex, match.index) });
    }

    const inlineMath = match[1];
    const displayMath = match[2];
    parts.push({
      kind: "math",
      value: inlineMath ?? displayMath ?? "",
      displayMode: displayMath !== undefined,
    });
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ kind: "text", value: text.slice(lastIndex) });
  }

  return parts;
}
