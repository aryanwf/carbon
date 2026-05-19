"use client";

import { useState } from "react";
import { PaperDetail } from "@/components/PaperDetail";
import { PaperGraph } from "@/components/PaperGraph";
import { PaperList } from "@/components/PaperList";
import { PaperReader } from "@/components/PaperReader";
import { ResizeHandle } from "@/components/ResizeHandle";
import type {
  LibraryFilter,
  Paper,
  PaperConnection,
  WorkspaceView,
} from "@/lib/types";

const MIN_LIST = 260;
const MAX_LIST = 520;
const MIN_DETAIL = 320;
const MAX_DETAIL = 640;

type DetailTab = "overview" | "chat" | "notes";

const EMPTY_PAPERS: Paper[] = [];
const EMPTY_CONNECTIONS: PaperConnection[] = [];

export function Workspace() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("graph");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<DetailTab>("overview");

  const [listWidth, setListWidth] = useState(320);
  const [detailWidth, setDetailWidth] = useState(420);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);

  const selectedPaper = EMPTY_PAPERS.find((p) => p.id === selectedId) ?? null;

  const resizeList = (delta: number) => {
    setListWidth((w) => Math.max(MIN_LIST, Math.min(MAX_LIST, w + delta)));
  };
  const resizeDetail = (delta: number) => {
    setDetailWidth((w) =>
      Math.max(MIN_DETAIL, Math.min(MAX_DETAIL, w - delta)),
    );
  };

  return (
    <div className="flex h-screen w-full flex-col gap-3 overflow-hidden bg-background p-3 font-sans text-foreground">
      <TopBar
        view={view}
        onViewChange={setView}
        listCollapsed={listCollapsed}
        detailCollapsed={detailCollapsed}
        onToggleList={() => setListCollapsed((v) => !v)}
        onToggleDetail={() => setDetailCollapsed((v) => !v)}
      />

      <div className="flex min-h-0 flex-1 gap-3">
        {!listCollapsed && (
          <>
            <div
              style={{ width: listWidth }}
              className="relative flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_2px_8px_rgba(244,241,234,0.035)]"
            >
              <PaperList
                papers={EMPTY_PAPERS}
                selectedId={selectedId}
                filter={filter}
                search={search}
                onSelect={setSelectedId}
                onFilterChange={setFilter}
                onSearchChange={setSearch}
                onAddClick={() => {}}
              />
            </div>
            <ResizeHandle onResize={resizeList} ariaLabel="Resize library" />
          </>
        )}

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_2px_8px_rgba(244,241,234,0.035)]">
          {view === "graph" ? (
            <PaperGraph
              papers={EMPTY_PAPERS}
              connections={EMPTY_CONNECTIONS}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <PaperReader paper={selectedPaper} />
          )}
        </div>

        {!detailCollapsed && (
          <>
            <ResizeHandle onResize={resizeDetail} ariaLabel="Resize detail" />
            <div
              style={{ width: detailWidth }}
              className="relative flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_2px_8px_rgba(244,241,234,0.035)]"
            >
              <PaperDetail
                paper={selectedPaper}
                tab={tab}
                onTabChange={setTab}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type TopBarProps = {
  view: WorkspaceView;
  onViewChange: (v: WorkspaceView) => void;
  listCollapsed: boolean;
  detailCollapsed: boolean;
  onToggleList: () => void;
  onToggleDetail: () => void;
};

function TopBar({
  view,
  onViewChange,
  listCollapsed,
  detailCollapsed,
  onToggleList,
  onToggleDetail,
}: TopBarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between rounded-xl border border-border bg-surface px-4 shadow-[0_2px_8px_rgba(244,241,234,0.035)]">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToggleList}
          className="group flex h-9 items-center justify-center rounded-md border border-border bg-surface-2 px-4 text-xs font-medium text-muted transition-all duration-300 ease-spring hover:border-white/20 hover:text-foreground active:scale-[0.98]"
        >
          {listCollapsed ? "Show Library" : "Hide Library"}
        </button>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl leading-none tracking-[-0.04em] text-foreground">
            Carbon
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
            Research
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-1">
        {(["graph", "reader"] as WorkspaceView[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onViewChange(v)}
            className={`rounded-md px-4 py-1.5 text-xs font-medium capitalize transition-all duration-300 ease-spring ${
              view === v
                ? "bg-accent text-background"
                : "text-muted hover:bg-white/5 hover:text-foreground"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggleDetail}
        className="group flex h-9 items-center justify-center rounded-md border border-border bg-surface-2 px-4 text-xs font-medium text-muted transition-all duration-300 ease-spring hover:border-white/20 hover:text-foreground active:scale-[0.98]"
      >
        {detailCollapsed ? "Show Detail" : "Hide Detail"}
      </button>
    </header>
  );
}
