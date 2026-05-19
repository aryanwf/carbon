import {
  envErrorResponse,
  requireRequestUser,
} from "@/lib/supabase";
import { importPaperUrl } from "@/lib/paper-ingestion";
import { getUserLibrary } from "@/lib/papers";

export const runtime = "nodejs";

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
    const payload = (await request.json()) as { url?: unknown };
    const url = typeof payload.url === "string" ? payload.url : "";
    const paper = await importPaperUrl(auth.user.id, url);

    return Response.json({ paper }, { status: 201 });
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
