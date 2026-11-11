import { requireRequestUser } from "@/lib/auth";
import { getDb } from "@/lib/cloudflare";
import {
  insertChatMessage,
  listChatHistoryStatement,
  listChatMessages,
  type ChatMessageRow,
} from "@/lib/chat-db";
import {
  buildSystemPrompt,
  streamChat,
  type ChatLibraryEntry,
  type ChatTurn,
} from "@/lib/chat";
import { extractPaperText } from "@/lib/enrichment";
import { envErrorResponse, internalErrorResponse, sseResponse } from "@/lib/http";
import { parseBsScoreColumn, stringArray, type PaperRow } from "@/lib/papers";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_CHARS = 4_000;
const HISTORY_TURNS = 20;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  let db: D1Database;
  try {
    db = getDb();
  } catch (error) {
    return envErrorResponse(error);
  }

  const { id } = await params;
  const paperId = decodeURIComponent(id);

  try {
    const messages = await listChatMessages(db, auth.user.id, paperId);
    return Response.json({ messages });
  } catch (error) {
    return internalErrorResponse(error, "Failed to load chat");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  let db: D1Database;
  try {
    db = getDb();
  } catch (error) {
    return envErrorResponse(error);
  }

  const { id } = await params;
  const paperId = decodeURIComponent(id);
  const userId = auth.user.id;

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

  let paper: PaperRow;
  let historyRows: ChatTurn[];
  let library: ChatLibraryEntry[];

  try {
    const [ownershipResult, paperResult, historyResult, libraryResult] =
      await db.batch([
        db
          .prepare("SELECT id FROM user_papers WHERE user_id = ?1 AND paper_id = ?2")
          .bind(userId, paperId),
        db
          .prepare(
            `SELECT id, title, authors, abstract, published, categories, summary,
                    bs_score, pdf_url, source_url
             FROM papers WHERE id = ?1`,
          )
          .bind(paperId),
        listChatHistoryStatement(db, userId, paperId, HISTORY_TURNS),
        db
          .prepare(
            `SELECT p.id, p.title, p.categories
             FROM user_papers up
             JOIN papers p ON p.id = up.paper_id
             WHERE up.user_id = ?1 AND up.paper_id <> ?2
             ORDER BY up.added_at DESC
             LIMIT 40`,
          )
          .bind(userId, paperId),
      ]);

    if (ownershipResult.results.length === 0) {
      return Response.json({ error: "Paper not in library" }, { status: 404 });
    }

    const row = paperResult.results[0] as PaperRow | undefined;
    if (!row) {
      return Response.json({ error: "Paper not found" }, { status: 404 });
    }

    paper = row;
    historyRows = historyResult.results as ChatTurn[];
    library = (
      libraryResult.results as { id: string; title: string; categories: string | null }[]
    )
      .filter((entry) => entry.id && entry.title)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        categories: stringArray(entry.categories),
      }));
  } catch (error) {
    return internalErrorResponse(error, "Failed to load paper");
  }

  const authors = stringArray(paper.authors);
  const categories = stringArray(paper.categories);

  // Full text is cached in R2 after the first extraction, so this is usually
  // a single R2 read.
  const paperText = await extractPaperText({
    id: paper.id,
    title: paper.title,
    authors,
    abstract: paper.abstract,
    categories,
    pdf_url: paper.pdf_url,
    source_url: paper.source_url,
  }).catch(() => "");

  const history: ChatTurn[] = historyRows.slice().reverse();

  const systemPrompt = buildSystemPrompt(
    {
      id: paper.id,
      title: paper.title,
      authors,
      abstract: paper.abstract ?? null,
      categories,
      summary: paper.summary ?? null,
      bs_score: parseBsScoreColumn(paper.bs_score),
      paper_text: paperText,
    },
    library,
  );

  let userMsg: ChatMessageRow;
  try {
    userMsg = await insertChatMessage(db, {
      user_id: userId,
      paper_id: paperId,
      role: "user",
      content: message,
    });
  } catch (error) {
    return internalErrorResponse(error, "Failed to save message");
  }

  // A disconnect aborts the upstream completion; as before, a cancelled reply
  // is not saved. A reply that finished streaming is saved under waitUntil.
  return sseResponse(request, async (send, signal) => {
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
        signal,
      );

      try {
        const assistantMsg = await insertChatMessage(db, {
          user_id: userId,
          paper_id: paperId,
          role: "assistant",
          content: full,
        });
        send("assistant_message", assistantMsg);
      } catch (error) {
        console.error("Saving assistant message failed:", error);
        send("error", { message: "Failed to save message" });
      }
      send("done", { ok: true });
    } catch (error) {
      if (signal.aborted) return;
      send("error", {
        message: error instanceof Error ? error.message : "Chat failed",
      });
    }
  });
}
