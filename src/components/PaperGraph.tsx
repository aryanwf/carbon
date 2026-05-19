"use client";

import type { Paper, PaperConnection } from "@/lib/types";

type Props = {
  papers: Paper[];
  connections: PaperConnection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function PaperGraph({ papers }: Props) {
  return (
    <div className="flex h-full items-center justify-center bg-surface-2 p-8 text-center">
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-surface px-10 py-14 shadow-[0_2px_8px_rgba(244,241,234,0.035)]">
        <div className="absolute left-8 top-8 flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        </div>
        <p className="mx-auto max-w-sm font-display text-4xl leading-none tracking-[-0.04em] text-foreground">
          Build a living map of your papers.
        </p>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-muted">
          Sigma.js + Graphology renderer mounts here. Nodes:{" "}
          <span className="font-medium text-foreground">{papers.length}</span>.
        </p>
      </div>
    </div>
  );
}
