"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { CommunityFeed } from "@/components/CommunityFeed";
import { PaperDetail } from "@/components/PaperDetail";
import { PaperList } from "@/components/PaperList";
import { PaperReader } from "@/components/PaperReader";
import { ResizeHandle } from "@/components/ResizeHandle";
import type { Paper, PaperConnection, WorkspaceView } from "@/lib/types";

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

type ImportPaperResponse = {
  paper: Paper | null;
  papers: Paper[];
  errors?: { url: string; error: string }[];
};

type ImportProgressState = {
  total: number;
  completed: number;
  failed: number;
  inFlight: string[];
};

type ImportProgressEvent =
  | { type: "start"; total: number; urls: string[] }
  | { type: "paper_start"; index: number; url: string }
  | { type: "paper_done"; index: number; url: string; paper: Paper }
  | { type: "paper_error"; index: number; url: string; error: string };

type PaperGraphProps = {
  papers: Paper[];
  connections: PaperConnection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const PaperGraph = dynamic<PaperGraphProps>(
  () => import("@/components/PaperGraph").then((module) => module.PaperGraph),
  {
    ssr: false,
    loading: () => (
      <AuthStatus title="Loading graph" message="Preparing WebGL renderer." />
    ),
  },
);

type WorkspaceProps = {
  initialPapers: Paper[];
  initialConnections: PaperConnection[];
  initialLibraryError: string | null;
  initialLibraryUserId: string | null;
  initialProfileUsername: string | null;
  initialProfileAvatarUrl: string | null;
};

export function Workspace({
  initialPapers,
  initialConnections,
  initialLibraryError,
  initialLibraryUserId,
  initialProfileUsername,
  initialProfileAvatarUrl,
}: WorkspaceProps) {
  const { user, loading, error, signInWithGoogle, signOut } = useAuth();
  const loadedLibraryUserIdRef = useRef<string | null>(initialLibraryUserId);
  const userId = user?.id ?? null;
  const signedIn = user !== null;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("reader");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<DetailTab>("overview");

  const [listWidth, setListWidth] = useState(320);
  const [detailWidth, setDetailWidth] = useState(420);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [papers, setPapers] = useState<Paper[]>(initialPapers);
  const [connections, setConnections] =
    useState<PaperConnection[]>(initialConnections);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(
    initialLibraryError,
  );
  const [importingPaper, setImportingPaper] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] =
    useState<ImportProgressState | null>(null);

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
        const response = await fetch("/api/papers", {
          signal: controller.signal,
        });
        const contentType = response.headers.get("content-type") ?? "";
        const payload = (
          contentType.includes("application/json")
            ? await response.json()
            : { error: await response.text() }
        ) as PapersResponse & { error?: string };

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
  const importPaper = async (url: string) => {
    if (!signedIn) {
      setImportError("Sign in required");
      return false;
    }

    setImportingPaper(true);
    setImportError(null);
    setImportProgress(null);

    try {
      const response = await fetch("/api/papers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        try {
          const parsed = JSON.parse(detail) as { error?: string };
          throw new Error(parsed.error ?? "Failed to import paper");
        } catch {
          throw new Error(detail || "Failed to import paper");
        }
      }

      const result = await consumeImportStream(response.body, (event) => {
        setImportProgress((prev) => reduceImportProgress(prev, event));
      });

      const imported = result.papers.length > 0 ? result.papers : result.paper ? [result.paper] : [];

      if (imported.length === 0) {
        throw new Error("Failed to import paper");
      }

      setPapers((currentPapers) => {
        const importedIds = new Set(imported.map((entry) => entry.id));
        return [
          ...imported,
          ...currentPapers.filter((entry) => !importedIds.has(entry.id)),
        ];
      });
      setSelectedId(imported[0].id);
      loadedLibraryUserIdRef.current = userId;

      if (result.errors && result.errors.length > 0) {
        const failed = result.errors
          .map((entry) => `${entry.url}: ${entry.error}`)
          .join("; ");
        setImportError(
          `Imported ${imported.length} paper${imported.length === 1 ? "" : "s"}. Failed: ${failed}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to import paper";
      setImportError(message);
      return false;
    } finally {
      setImportingPaper(false);
      setImportProgress(null);
    }
  };

  if (loading) {
    return <AuthStatus title="Loading Carbon" message="Checking session." />;
  }

  if (!signedIn) {
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
        profileUsername={initialProfileUsername}
        profileAvatarUrl={initialProfileAvatarUrl}
        onViewChange={setView}
        detailCollapsed={detailCollapsed}
        onAddPaper={() => setImportOpen(true)}
        onToggleDetail={() => setDetailCollapsed((v) => !v)}
        onSignOut={() => {
          void signOut();
        }}
      />

      <div className="flex min-h-0 flex-1 gap-3">
        <div
          style={{ width: listWidth }}
          className="relative flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_2px_8px_rgba(244,241,234,0.035)]"
        >
          <PaperList
            papers={papers}
            selectedId={selectedId}
            search={search}
            onSelect={setSelectedId}
            onSearchChange={setSearch}
            onAddPaper={importPaper}
            importingPaper={importingPaper}
            importError={importError}
            importProgress={importProgress}
            importOpen={importOpen}
            onImportOpenChange={setImportOpen}
          />
        </div>
        <ResizeHandle onResize={resizeList} ariaLabel="Resize library" />

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_2px_8px_rgba(244,241,234,0.035)]">
          {libraryLoading ? (
            <AuthStatus title="Loading library" message="Fetching your papers." />
          ) : libraryError ? (
            <AuthStatus title="Library error" message={libraryError} />
          ) : view === "community" ? (
            <CommunityFeed signedIn={signedIn} />
          ) : view === "graph" ? (
            <PaperGraph
              papers={papers}
              connections={connections}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <PaperReader paper={selectedPaper} signedIn={signedIn} />
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
                signedIn={signedIn}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function reduceImportProgress(
  prev: ImportProgressState | null,
  event: ImportProgressEvent,
): ImportProgressState | null {
  switch (event.type) {
    case "start":
      return {
        total: event.total,
        completed: 0,
        failed: 0,
        inFlight: [],
      };
    case "paper_start":
      if (!prev) return prev;
      return { ...prev, inFlight: [...prev.inFlight, event.url] };
    case "paper_done":
      if (!prev) return prev;
      return {
        ...prev,
        completed: prev.completed + 1,
        inFlight: prev.inFlight.filter((url) => url !== event.url),
      };
    case "paper_error":
      if (!prev) return prev;
      return {
        ...prev,
        failed: prev.failed + 1,
        inFlight: prev.inFlight.filter((url) => url !== event.url),
      };
  }
}

async function consumeImportStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ImportProgressEvent) => void,
): Promise<ImportPaperResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: ImportPaperResponse | null = null;
  let streamError: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEvent(rawEvent);
      if (!parsed) continue;

      if (parsed.event === "progress") {
        onEvent(parsed.data as ImportProgressEvent);
      } else if (parsed.event === "done") {
        final = parsed.data as ImportPaperResponse;
      } else if (parsed.event === "error") {
        streamError =
          (parsed.data as { message?: string })?.message ?? "Import failed";
      }
    }
  }

  if (streamError) throw new Error(streamError);
  if (!final) throw new Error("Import stream ended unexpectedly");
  return final;
}

function parseSseEvent(
  raw: string,
): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }

  if (dataLines.length === 0) return null;

  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

type TopBarProps = {
  view: WorkspaceView;
  profileUsername: string | null;
  profileAvatarUrl: string | null;
  onViewChange: (v: WorkspaceView) => void;
  detailCollapsed: boolean;
  onAddPaper: () => void;
  onToggleDetail: () => void;
  onSignOut: () => void;
};

function TopBar({
  view,
  profileUsername,
  profileAvatarUrl,
  onViewChange,
  detailCollapsed,
  onAddPaper,
  onToggleDetail,
  onSignOut,
}: TopBarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between rounded-xl border border-border bg-surface px-4 shadow-[0_2px_8px_rgba(244,241,234,0.035)]">
      <div className="flex items-center gap-3">
        <Image
          src="/web-app-manifest-192x192.png"
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 rounded-md"
        />
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl leading-none tracking-[-0.04em] text-foreground">
            Carbon
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
            Research
          </span>
        </div>
        <button
          type="button"
          onClick={onAddPaper}
          aria-label="Add paper"
          className="group ml-1 flex h-8 w-8 items-center justify-center rounded-md bg-accent text-background transition-all duration-300 ease-spring hover:bg-[#ddd7cb] active:scale-[0.98]"
        >
          <span className="mb-[1px] text-xl leading-none">+</span>
        </button>
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-1">
        {(["reader", "graph", "community"] as WorkspaceView[]).map((v) => (
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
        {profileUsername ? (
          <Link
            href={`/u/${encodeURIComponent(profileUsername)}`}
            className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2 text-muted transition-all duration-300 ease-spring hover:border-white/20 hover:text-foreground active:scale-[0.98]"
            aria-label="View profile"
            title="View profile"
          >
            {profileAvatarUrl ? (
              <span
                className="h-full w-full bg-cover bg-center"
                style={{ backgroundImage: `url(${JSON.stringify(profileAvatarUrl)})` }}
              />
            ) : (
              <ProfileIcon />
            )}
          </Link>
        ) : null}
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

function ProfileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
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
