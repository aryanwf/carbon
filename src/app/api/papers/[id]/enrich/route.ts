import { requireRequestUser } from "@/lib/auth";
import { getDb } from "@/lib/cloudflare";
import {
  computeBsScore,
  computeEmbedding,
  discoverConnections,
  extractPaperText,
  persistBsScore,
  persistEmbedding,
  persistSummary,
  streamSummary,
  type EnrichmentPaper,
} from "@/lib/enrichment";
import { envErrorResponse, internalErrorResponse, sseResponse } from "@/lib/http";
import { stringArray, type PaperRow } from "@/lib/papers";

export const dynamic = "force-dynamic";

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

  let paper: EnrichmentPaper;

  try {
    const [ownershipResult, paperResult] = await db.batch([
      db
        .prepare("SELECT id FROM user_papers WHERE user_id = ?1 AND paper_id = ?2")
        .bind(auth.user.id, paperId),
      db
        .prepare(
          `SELECT id, title, authors, abstract, published, categories, pdf_url, source_url
           FROM papers WHERE id = ?1`,
        )
        .bind(paperId),
    ]);

    if (ownershipResult.results.length === 0) {
      return Response.json({ error: "Paper not in library" }, { status: 404 });
    }

    const row = paperResult.results[0] as PaperRow | undefined;
    if (!row) {
      return Response.json({ error: "Paper not found" }, { status: 404 });
    }

    paper = {
      id: row.id,
      title: row.title,
      authors: stringArray(row.authors),
      abstract: row.abstract,
      categories: stringArray(row.categories),
      pdf_url: row.pdf_url,
      source_url: row.source_url,
    };
  } catch (error) {
    return internalErrorResponse(error, "Failed to load paper");
  }

  // Database writes are wrapped so step errors never expose D1 error text.
  const save = (step: string, write: Promise<unknown>) =>
    write.catch((error: unknown) => {
      console.error(`Saving ${step} failed:`, error);
      throw new Error(`Failed to save ${step}`);
    });

  // A disconnect aborts the upstream model calls; steps that already
  // finished are still persisted (the handler runs under waitUntil).
  return sseResponse(request, async (send, signal) => {
    try {
      send("status", { stage: "extracting" });
      const text = await extractPaperText(paper);
      send("text", { length: text.length });

      const summaryPromise = (async () => {
        send("status", { stage: "summary_started" });
        const summary = await streamSummary(
          paper,
          text,
          (chunk) => send("summary_chunk", { delta: chunk }),
          signal,
        );
        await save("summary", persistSummary(paper.id, summary));
        send("summary_done", { summary });
        return summary;
      })();

      const bsPromise = (async () => {
        send("status", { stage: "bs_score_started" });
        const bs = await computeBsScore(paper, text, signal);
        await save("BS score", persistBsScore(paper.id, bs));
        send("bs_score", bs);
        return bs;
      })();

      const connectionsPromise = (async () => {
        send("status", { stage: "embedding_started" });
        const embedding = await computeEmbedding(
          text || paper.title || paper.id,
          signal,
        );
        const stored = await persistEmbedding(paper.id, embedding);
        send("embedding", { dimensions: embedding.length });
        send("status", { stage: "connections_started" });
        const connections = stored
          ? await discoverConnections(paper.id, embedding)
          : [];
        send("connections", { connections });
        return connections;
      })();

      const results = await Promise.allSettled([
        summaryPromise,
        bsPromise,
        connectionsPromise,
      ]);

      const labels = ["summary", "bs_score", "connections"] as const;
      for (const [index, result] of results.entries()) {
        if (result.status === "rejected") {
          send("step_error", {
            step: labels[index],
            message:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
      }

      send("done", { ok: true });
    } catch (error) {
      send("error", {
        message: error instanceof Error ? error.message : "Enrichment failed",
      });
    }
  });
}