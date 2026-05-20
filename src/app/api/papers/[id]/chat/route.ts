import {
  envErrorResponse,
  getSupabaseAdmin,
  requireRequestUser,
  type PaperRow,
} from "@/lib/supabase";
import {
  insertChatMessage,
  listChatHistory,
  listChatMessages,
  type ChatMessageRow,
} from "@/lib/chat-db";
import {
  buildSystemPrompt,
  streamChat,
  type ChatLibraryEntry,
  type ChatTurn,
} from "@/lib/chat";
import { extractPaperText, type EnrichmentPaper } from "@/lib/enrichment";
import type { BsScore } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_MESSAGE_CHARS = 4_000;
const HISTORY_TURNS = 20;

type ChatRow = ChatMessageRow;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (error) {
    return envErrorResponse(error);
  }

  const { id } = await params;
  const paperId = decodeURIComponent(id);

  const { data, error } = await listChatMessages(
    supabaseAdmin,
    auth.user.id,
    paperId,
  );

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ messages: (data ?? []) as ChatRow[] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (error) {
    return envErrorResponse(error);
  }

  const { id } = await params;
  const paperId = decodeURIComponent(id);

  let payload: { message?: unknown };
  try {
    payload = (await request.json()) as { message?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return Response.json(
      { error: `message exceeds ${MAX_MESSAGE_CHARS} chars` },
      { status: 400 },
    );
  }

  const { data: ownership, error: ownershipError } = await supabaseAdmin
    .from("user_papers")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("paper_id", paperId)
    .maybeSingle();

  if (ownershipError) {
    return Response.json({ error: ownershipError.message }, { status: 500 });
  }
  if (!ownership) {
    return Response.json({ error: "Paper not in library" }, { status: 404 });
  }

  const { data: paperRow, error: paperError } = await supabaseAdmin
    .from("papers")
    .select(
      "id,title,authors,abstract,categories,summary,bs_score,pdf_url,source_url",
    )
    .eq("id", paperId)
    .maybeSingle();

  if (paperError) {
    return Response.json({ error: paperError.message }, { status: 500 });
  }
  if (!paperRow) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const paper = paperRow as PaperRow &
    Pick<EnrichmentPaper, "id" | "title" | "authors" | "abstract" | "categories" | "pdf_url" | "source_url">;

  const [historyResult, libraryResult, paperText] = await Promise.all([
      listChatHistory(supabaseAdmin, auth.user.id, paperId, HISTORY_TURNS),
      supabaseAdmin
        .from("user_papers")
        .select("paper_id, papers!inner(id,title,categories)")
        .eq("user_id", auth.user.id)
        .neq("paper_id", paperId)
        .order("added_at", { ascending: false })
        .limit(40),
      extractPaperText(paper).catch(() => ""),
    ]);

  if (historyResult.error) {
    return Response.json({ error: historyResult.error.message }, { status: 500 });
  }
  if (libraryResult.error) {
    return Response.json({ error: libraryResult.error.message }, { status: 500 });
  }

  const historyRows = historyResult.data;
  const libraryRows = libraryResult.data;

  const history: ChatTurn[] = ((historyRows ?? []) as ChatTurn[])
    .slice()
    .reverse();

  const library: ChatLibraryEntry[] = ((libraryRows ?? []) as unknown[])
    .map((row) => {
      const r = row as {
        papers?: { id?: string; title?: string; categories?: unknown };
      };
      const p = r.papers;
      if (!p?.id || !p.title) return null;
      return {
        id: p.id,
        title: p.title,
        categories: Array.isArray(p.categories)
          ? (p.categories as unknown[]).filter(
              (c): c is string => typeof c === "string",
            )
          : [],
      } satisfies ChatLibraryEntry;
    })
    .filter((entry): entry is ChatLibraryEntry => entry !== null);

  const systemPrompt = buildSystemPrompt(
    {
      id: paper.id,
      title: paper.title,
      authors: Array.isArray(paper.authors)
        ? (paper.authors as unknown[]).filter(
            (a): a is string => typeof a === "string",
          )
        : [],
      abstract: paper.abstract ?? null,
      categories: Array.isArray(paper.categories)
        ? (paper.categories as unknown[]).filter(
            (c): c is string => typeof c === "string",
          )
        : [],
      summary: paper.summary ?? null,
      bs_score: (paper.bs_score as BsScore | null) ?? null,
      paper_text: paperText,
    },
    library,
  );

  const { data: userMsg, error: userInsertError } = await insertChatMessage(
    supabaseAdmin,
    {
      user_id: auth.user.id,
      paper_id: paperId,
      role: "user",
      content: message,
    },
  );

  if (userInsertError || !userMsg) {
    return Response.json(
      { error: userInsertError?.message ?? "Failed to save message" },
      { status: 500 },
    );
  }

  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
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
        send("user_message", userMsg);

        const turns: ChatTurn[] = [
          ...history,
          { role: "user", content: message },
        ];

        const full = await streamChat(
          systemPrompt,
          turns,
          (delta) => send("delta", { content: delta }),
          abortController.signal,
        );

        const { data: assistantMsg, error: assistantInsertError } =
          await insertChatMessage(supabaseAdmin, {
            user_id: auth.user.id,
            paper_id: paperId,
            role: "assistant",
            content: full,
          });

        if (assistantInsertError) {
          send("error", { message: assistantInsertError.message });
        } else if (assistantMsg) {
          send("assistant_message", assistantMsg);
        }
        send("done", { ok: true });
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : "Chat failed",
        });
      } finally {
        close();
      }
    },
    cancel() {
      abortController.abort();
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
