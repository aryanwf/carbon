"use client";

import type { Paper } from "@/lib/types";

type Props = {
  paper: Paper | null;
};

export function PaperReader({ paper }: Props) {
  if (!paper) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-2 p-8">
        <div className="relative w-full max-w-xl rounded-xl border border-border bg-surface px-10 py-14 text-center shadow-[0_2px_8px_rgba(244,241,234,0.035)]">
          <div className="absolute left-8 top-8 flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          </div>
          <p className="mx-auto max-w-sm font-display text-4xl leading-none tracking-[-0.04em] text-foreground">
            Reader ready
          </p>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-muted">
            Select a paper from the library to open the PDF workspace.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-surface-2 px-6 text-center">
      <div className="inline-block rounded-full bg-[#2a2418] px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#e3bb74]">
        PDF Reader
      </div>
      <p className="max-w-sm text-sm leading-6 text-muted">
        Embedded PDF viewer mounts here for{" "}
        <span className="text-foreground">{paper.title}</span>.
      </p>
    </div>
  );
}
