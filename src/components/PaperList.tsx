"use client";

import { useState, type FormEvent } from "react";
import type { Paper } from "@/lib/types";

type Props = {
  papers: Paper[];
  selectedId: string | null;
  search: string;
  onSelect: (id: string) => void;
  onSearchChange: (q: string) => void;
  onAddPaper: (url: string) => Promise<boolean>;
  importingPaper: boolean;
  importError: string | null;
  importOpen: boolean;
  onImportOpenChange: (open: boolean) => void;
};

export function PaperList({
  papers,
  selectedId,
  search,
  onSelect,
  onSearchChange,
  onAddPaper,
  importingPaper,
  importError,
  importOpen,
  onImportOpenChange,
}: Props) {
  const [importUrl, setImportUrl] = useState("");
  const query = search.trim().toLowerCase();
  const visible = papers.filter((p) => {
    if (!query) return true;
    return (
      p.title.toLowerCase().includes(query) ||
      p.authors.some((author) => author.toLowerCase().includes(query))
    );
  });
  const submitImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const imported = await onAddPaper(importUrl);

    if (imported) {
      setImportUrl("");
      onImportOpenChange(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-5">
        <h2 className="font-display text-2xl leading-none tracking-[-0.03em] text-foreground">
          Library
        </h2>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          Papers and sources
        </p>
      </header>

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <form
            onSubmit={submitImport}
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-3xl leading-none tracking-[-0.04em] text-foreground">
                  Add paper
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Paste an arXiv URL, direct PDF link, or paper webpage.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onImportOpenChange(false)}
                disabled={importingPaper}
                className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-all duration-300 ease-spring hover:border-white/20 hover:text-foreground active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="mt-6 space-y-3">
              <input
                type="url"
                value={importUrl}
                onChange={(event) => setImportUrl(event.target.value)}
                placeholder="https://arxiv.org/abs/..."
                disabled={importingPaper}
                required
                autoFocus
                className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-300 ease-spring placeholder:text-muted/60 focus:border-white/20 focus:bg-background disabled:cursor-not-allowed disabled:opacity-60"
              />
              {importError && (
                <p className="text-xs leading-5 text-[#e3bb74]">{importError}</p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onImportOpenChange(false)}
                disabled={importingPaper}
                className="rounded-md border border-border bg-surface-2 px-4 py-2 text-xs font-medium text-muted transition-all duration-300 ease-spring hover:border-white/20 hover:text-foreground active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={importingPaper}
                className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-background transition-all duration-300 ease-spring hover:bg-[#ddd7cb] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importingPaper ? "Importing..." : "Import Paper"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="border-b border-border bg-surface-2 px-6 py-5">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search papers"
          className="w-full rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground outline-none transition-all duration-300 ease-spring placeholder:text-muted/60 focus:border-white/20 focus:bg-background"
        />
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <li className="mx-2 mt-2 rounded-xl border border-border bg-surface-2 px-6 py-10 text-center">
            <p className="font-display text-2xl leading-none tracking-[-0.03em] text-foreground">
              {papers.length === 0 ? "No papers yet" : "No matches"}
            </p>
            <p className="mt-3 text-sm leading-6 text-muted">
              {papers.length === 0
                ? "Add a PDF or source URL to start building your research map."
                : "Try a different search term."}
            </p>
          </li>
        ) : (
          visible.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                className={`group flex w-full flex-col gap-1.5 rounded-lg px-4 py-4 text-left transition-all duration-300 ease-spring ${
                  selectedId === p.id ? "bg-accent-soft" : "hover:bg-surface-2"
                }`}
              >
                <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                  {p.title}
                </span>
                <span className="line-clamp-1 font-mono text-[10px] text-muted">
                  {p.authors.join(", ") || "Unknown authors"}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
