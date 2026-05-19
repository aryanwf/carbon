"use client";

import type { LibraryFilter, Paper } from "@/lib/types";

type Props = {
  papers: Paper[];
  selectedId: string | null;
  filter: LibraryFilter;
  search: string;
  onSelect: (id: string) => void;
  onFilterChange: (f: LibraryFilter) => void;
  onSearchChange: (q: string) => void;
  onAddClick: () => void;
};

const FILTERS: LibraryFilter[] = ["all", "unread", "read"];

export function PaperList({
  papers,
  selectedId,
  filter,
  search,
  onSelect,
  onFilterChange,
  onSearchChange,
  onAddClick,
}: Props) {
  const visible = papers.filter((p) => {
    if (filter === "read" && !p.is_read) return false;
    if (filter === "unread" && p.is_read) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-5">
        <div>
          <h2 className="font-display text-2xl leading-none tracking-[-0.03em] text-foreground">
            Library
          </h2>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            Papers and sources
          </p>
        </div>
        <button
          type="button"
          onClick={onAddClick}
          className="group flex items-center gap-2 rounded-md bg-accent py-1 pl-4 pr-1 text-xs font-medium text-background transition-all duration-300 ease-spring hover:bg-[#ddd7cb] active:scale-[0.98]"
        >
          <span>Add Paper</span>
          <div className="flex h-6 w-6 items-center justify-center rounded bg-black/10 transition-transform duration-300 ease-spring group-hover:scale-105 group-hover:bg-black/15">
            <span className="mb-[2px] text-lg leading-none">+</span>
          </div>
        </button>
      </header>

      <div className="space-y-4 border-b border-border bg-surface-2 px-6 py-5">
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search papers"
            className="w-full rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground outline-none transition-all duration-300 ease-spring placeholder:text-muted/60 focus:border-white/20 focus:bg-background"
          />
        </div>
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFilterChange(f)}
              className={`flex-1 rounded-md border py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] transition-all duration-300 ease-spring ${
                filter === f
                  ? "border-accent bg-accent text-background"
                  : "border-border bg-surface text-muted hover:border-white/20 hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <li className="mx-2 mt-2 rounded-xl border border-border bg-surface-2 px-6 py-10 text-center">
            <p className="font-display text-2xl leading-none tracking-[-0.03em] text-foreground">
              No papers yet
            </p>
            <p className="mt-3 text-sm leading-6 text-muted">
              Add a PDF or source URL to start building your research map.
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
