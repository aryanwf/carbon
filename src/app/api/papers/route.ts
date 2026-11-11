import { requireRequestUser } from "@/lib/auth";
import { envErrorResponse, internalErrorResponse, sseResponse } from "@/lib/http";
import {
  importPaperUrls,
  MAX_IMPORT_URLS,
  parseImportUrls,
  type ImportProgressEvent,
} from "@/lib/paper-ingestion";
import { getUserLibrary } from "@/lib/papers";

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

    return internalErrorResponse(error, "Failed to load papers");
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

    if (urls.length > MAX_IMPORT_URLS) {
      return Response.json(
        { error: `At most ${MAX_IMPORT_URLS} URLs can be imported at once` },
        { status: 400 },
      );
    }

    const wantsStream = (request.headers.get("accept") ?? "").includes(
      "text/event-stream",
    );

    if (wantsStream) {
      const userId = auth.user.id;

      // Imports keep running after a disconnect, so the abort signal is unused.
      return sseResponse(request, async (send) => {
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
        }
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

    // Import errors are user-facing (database failures are already replaced
    // with generic messages in importPaperUrl).
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
