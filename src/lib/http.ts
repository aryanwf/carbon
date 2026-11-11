import { getCtx } from "@/lib/cloudflare";

/** Maps missing-configuration errors to a 500 JSON response; rethrows anything else. */
export function envErrorResponse(error: unknown) {
  if (error instanceof Error && error.message.includes("is required")) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  throw error;
}

/** Logs the underlying error and returns a generic `{error}` 500 response. */
export function internalErrorResponse(error: unknown, message: string) {
  console.error(`${message}:`, error);
  return Response.json({ error: message }, { status: 500 });
}

/** SQLite FOREIGN KEY failures, e.g. referencing a paper that does not exist. */
export function isForeignKeyError(error: unknown) {
  return error instanceof Error && error.message.includes("FOREIGN KEY constraint failed");
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export type SseSend = (event: string, data: unknown) => void;

/**
 * Streams server-sent events produced by `run`. After the client disconnects,
 * `send` becomes a no-op and `signal` aborts (pass it to upstream fetches that
 * should stop); everything else in `run` keeps going under waitUntil so
 * database writes are not lost.
 */
export function sseResponse(
  request: Request,
  run: (send: SseSend, signal: AbortSignal) => Promise<void>,
) {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  request.signal?.addEventListener("abort", abort, { once: true });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send: SseSend = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      const work = run(send, abortController.signal)
        .catch((error) => console.error("SSE handler failed:", error))
        .finally(() => {
          request.signal?.removeEventListener("abort", abort);
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {}
        });

      try {
        getCtx().waitUntil(work);
      } catch {
        // No execution context (e.g. outside the Workers runtime).
      }
    },
    cancel() {
      closed = true;
      abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
