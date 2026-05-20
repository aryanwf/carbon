import {
  envErrorResponse,
  requireRequestUser,
} from "@/lib/supabase";
import {
  importPaperUrls,
  parseImportUrls,
  type ImportProgressEvent,
} from "@/lib/paper-ingestion";
import { getUserLibrary } from "@/lib/papers";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = await requireRequestUser(request);

  if (auth.response) {
    return auth.response;
  }

  const userId = auth.user.id;

  try {
    return Response.json(await getUserLibrary(userId));
  } catch (error) {
    if (error instanceof Error && error.message.includes("is required")) {
      return envErrorResponse(error);
    }

    const message =
      error instanceof Error ? error.message : "Failed to load papers";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireRequestUser(request);

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = (await request.json()) as {
      url?: unknown;
      urls?: unknown;
    };
    const rawInput = Array.isArray(payload.urls)
      ? payload.urls.filter((value): value is string => typeof value === "string").join("\n")
      : typeof payload.url === "string"
        ? payload.url
        : "";
    const urls = parseImportUrls(rawInput);

    if (urls.length === 0) {
      return Response.json({ error: "Valid URL is required" }, { status: 400 });
    }

    const wantsStream = (request.headers.get("accept") ?? "").includes(
      "text/event-stream",
    );

    if (wantsStream) {
      const userId = auth.user.id;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          let closed = false;
          const send = (event: string, data: unknown) => {
            if (closed) return;
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          };
          const close = () => {
            if (closed) return;
            closed = true;
            try {
              controller.close();
            } catch {}
          };

          try {
            const { papers, errors } = await importPaperUrls(
              userId,
              rawInput,
              (event: ImportProgressEvent) => send("progress", event),
            );
            send("done", {
              paper: papers[0] ?? null,
              papers,
              errors,
            });
          } catch (error) {
            send("error", {
              message:
                error instanceof Error ? error.message : "Import failed",
            });
          } finally {
            close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const { papers, errors } = await importPaperUrls(auth.user.id, rawInput);
    const paper = papers[0] ?? null;

    return Response.json(
      {
        paper,
        papers,
        ...(errors.length > 0 ? { errors } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (error instanceof Error && error.message.includes("is required")) {
      return envErrorResponse(error);
    }

    const message =
      error instanceof Error ? error.message : "Failed to import paper";
    const status =
      message.includes("URL") ||
      message.includes("fetch") ||
      message.includes("exceeds")
        ? 400
        : 500;

    return Response.json({ error: message }, { status });
  }
}
