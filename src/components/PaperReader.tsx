"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Paper } from "@/lib/types";

import { ZoomMode } from "@embedpdf/react-pdf-viewer";

const PDFViewer = dynamic(
  () => import("@embedpdf/react-pdf-viewer").then((m) => m.PDFViewer),
  {
    ssr: false,
    loading: () => (
      <ReaderStatus title="Loading viewer" message="Initializing PDF engine." />
    ),
  },
);

type Props = {
  paper: Paper | null;
  accessToken: string | null;
};

export function PaperReader({ paper, accessToken }: Props) {
  const viewerHostRef = useRef<HTMLDivElement | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewerReady, setViewerReady] = useState(false);

  useEffect(() => {
    if (!paper || !accessToken) {
      setBlobUrl(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let createdUrl: string | null = null;

    const load = async () => {
      setLoading(true);
      setError(null);
      setBlobUrl(null);

      try {
        const response = await fetch(
          `/api/papers/${encodeURIComponent(paper.id)}/pdf`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const contentType = response.headers.get("content-type") ?? "";
          const message = contentType.includes("application/json")
            ? ((await response.json()) as { error?: string }).error
            : await response.text();
          throw new Error(message || `Request failed (${response.status})`);
        }

        const blob = await response.blob();
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Failed to load PDF");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();

    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [paper, accessToken]);

  useEffect(() => {
    setViewerReady(false);

    if (!blobUrl) return;

    const element = viewerHostRef.current;
    if (!element) return;

    let frame = 0;
    const markReady = () => {
      const rect = element.getBoundingClientRect();

      if (rect.width > 0 && rect.height > 0) {
        frame = requestAnimationFrame(() => setViewerReady(true));
      }
    };

    markReady();

    const observer = new ResizeObserver(markReady);
    observer.observe(element);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [blobUrl]);

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

  if (loading) {
    return <ReaderStatus title="Loading PDF" message="Fetching document." />;
  }

  if (error) {
    return <ReaderStatus title="Could not load PDF" message={error} />;
  }

  if (!blobUrl) {
    return (
      <ReaderStatus
        title="No PDF available"
        message="This paper does not have a PDF source attached."
      />
    );
  }

  return (
    <div ref={viewerHostRef} className="h-full w-full bg-surface-2">
      {viewerReady ? (
        <PDFViewer
          key={blobUrl}
          className="h-full w-full"
          style={{ height: "100%", width: "100%" }}
          config={{
            src: blobUrl,
            theme: { preference: "dark" },
            zoom: { defaultZoomLevel: ZoomMode.FitWidth },
          }}
          onReady={() => {
            requestAnimationFrame(() => {
              window.dispatchEvent(new Event("resize"));
            });
          }}
        />
      ) : (
        <ReaderStatus title="Preparing reader" message="Measuring workspace." />
      )}
    </div>
  );
}

function ReaderStatus({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-surface-2 px-6 text-center">
      <p className="font-display text-3xl leading-none tracking-[-0.04em] text-foreground">
        {title}
      </p>
      <p className="max-w-sm text-sm leading-6 text-muted">{message}</p>
    </div>
  );
}
