"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
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

type PapersResponse = {
  papers: Paper[];
  connections: PaperConnection[];
};

type WorkspaceProps = {
  initialPapers: Paper[];
  initialConnections: PaperConnection[];
  initialLibraryError: string | null;
  initialLibraryUserId: string | null;
};

export function Workspace({
  initialPapers,
  initialConnections,
  initialLibraryError,
  initialLibraryUserId,
}: WorkspaceProps) {
  const { session, user, loading, error, signInWithGoogle, signOut } = useAuth();
  const accessTokenRef = useRef<string | null>(null);
  const loadedLibraryUserIdRef = useRef<string | null>(initialLibraryUserId);
  const userId = session?.user.id ?? null;
  accessTokenRef.current = session?.access_token ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("graph");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<DetailTab>("overview");

  const [listWidth, setListWidth] = useState(320);
  const [detailWidth, setDetailWidth] = useState(420);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);

  const [papers, setPapers] = useState<Paper[]>(initialPapers);
  const [connections, setConnections] =
    useState<PaperConnection[]>(initialConnections);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(
    initialLibraryError,
  );

  useEffect(() => {
    if (!userId) {
      loadedLibraryUserIdRef.current = null;
      setPapers(EMPTY_PAPERS);
      setConnections(EMPTY_CONNECTIONS);
      setSelectedId(null);
      setLibraryError(null);
      return;
    }

    if (loadedLibraryUserIdRef.current === userId) {
      return;
    }

    const controller = new AbortController();

    const loadPapers = async () => {
      setLibraryLoading(true);
      setLibraryError(null);

      try {
        const accessToken = accessTokenRef.current;

        if (!accessToken) {
          throw new Error("Missing access token");
        }

        const response = await fetch("/api/papers", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        });
        const contentType = response.headers.get("content-type") ?? "";
        const payload = contentType.includes("application/json")
          ? await response.json()
          : { error: await response.text() };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load papers");
        }

        const nextData = payload as PapersResponse;
        setPapers(Array.isArray(nextData.papers) ? nextData.papers : []);
        setConnections(
          Array.isArray(nextData.connections) ? nextData.connections : [],
        );
        loadedLibraryUserIdRef.current = userId;
      } catch (loadError) {
        if (controller.signal.aborted) return;

        const message =
          loadError instanceof Error
            ? loadError.message
            : "Failed to load papers";
        setLibraryError(message);
      } finally {
        if (!controller.signal.aborted) {
          setLibraryLoading(false);
        }
      }
    };

    loadPapers();

    return () => controller.abort();
  }, [userId]);

  const selectedPaper = papers.find((p) => p.id === selectedId) ?? null;

  const resizeList = (delta: number) => {
    setListWidth((w) => Math.max(MIN_LIST, Math.min(MAX_LIST, w + delta)));
  };
  const resizeDetail = (delta: number) => {
    setDetailWidth((w) =>
      Math.max(MIN_DETAIL, Math.min(MAX_DETAIL, w - delta)),
    );
  };

  if (loading) {
    return <AuthStatus title="Loading Carbon" message="Checking session." />;
  }

  if (!session) {
    return (
      <AuthLanding
        error={error}
        onSignIn={() => {
          void signInWithGoogle();
        }}
      />
    );
  }

  return (
    <div className="flex h-screen w-full flex-col gap-3 overflow-hidden bg-background p-3 font-sans text-foreground">
      <TopBar
        view={view}
        userLabel={user?.email ?? "Signed in"}
        onViewChange={setView}
        listCollapsed={listCollapsed}
        detailCollapsed={detailCollapsed}
        onToggleList={() => setListCollapsed((v) => !v)}
        onToggleDetail={() => setDetailCollapsed((v) => !v)}
        onSignOut={() => {
          void signOut();
        }}
      />

      <div className="flex min-h-0 flex-1 gap-3">
        {!listCollapsed && (
          <>
            <div
              style={{ width: listWidth }}
              className="relative flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_2px_8px_rgba(244,241,234,0.035)]"
            >
              <PaperList
                papers={papers}
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
          {libraryLoading ? (
            <AuthStatus title="Loading library" message="Fetching your papers." />
          ) : libraryError ? (
            <AuthStatus title="Library error" message={libraryError} />
          ) : view === "graph" ? (
            <PaperGraph
              papers={papers}
              connections={connections}
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
  userLabel: string;
  onViewChange: (v: WorkspaceView) => void;
  listCollapsed: boolean;
  detailCollapsed: boolean;
  onToggleList: () => void;
  onToggleDetail: () => void;
  onSignOut: () => void;
};

function TopBar({
  view,
  userLabel,
  onViewChange,
  listCollapsed,
  detailCollapsed,
  onToggleList,
  onToggleDetail,
  onSignOut,
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

      <div className="flex items-center gap-2">
        <span className="hidden max-w-48 truncate font-mono text-[10px] text-muted lg:block">
          {userLabel}
        </span>
        <button
          type="button"
          onClick={onToggleDetail}
          className="group flex h-9 items-center justify-center rounded-md border border-border bg-surface-2 px-4 text-xs font-medium text-muted transition-all duration-300 ease-spring hover:border-white/20 hover:text-foreground active:scale-[0.98]"
        >
          {detailCollapsed ? "Show Detail" : "Hide Detail"}
        </button>
        <button
          type="button"
          onClick={onSignOut}
          className="group flex h-9 items-center justify-center rounded-md border border-border bg-surface-2 px-4 text-xs font-medium text-muted transition-all duration-300 ease-spring hover:border-white/20 hover:text-foreground active:scale-[0.98]"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}

function AuthLanding({
  error,
  onSignIn,
}: {
  error: string | null;
  onSignIn: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-xl rounded-2xl border border-border bg-surface px-10 py-12 text-center shadow-[0_2px_8px_rgba(244,241,234,0.035)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
          Research library
        </p>
        <h1 className="mt-4 font-display text-6xl leading-[0.9] tracking-[-0.05em]">
          Carbon
        </h1>
        <p className="mx-auto mt-5 max-w-sm text-sm leading-6 text-muted">
          Sign in with Google to build your private paper library and knowledge
          graph.
        </p>
        <button
          type="button"
          onClick={onSignIn}
          className="mt-8 rounded-md bg-accent px-5 py-2 text-sm font-medium text-background transition-all duration-300 ease-spring hover:bg-[#ddd7cb] active:scale-[0.98]"
        >
          Continue with Google
        </button>
        {error && <p className="mt-4 text-sm text-[#e3bb74]">{error}</p>}
      </section>
    </main>
  );
}

function AuthStatus({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface px-8 py-10 text-center">
        <p className="font-display text-3xl leading-none tracking-[-0.04em]">
          {title}
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">{message}</p>
      </div>
    </div>
  );
}
