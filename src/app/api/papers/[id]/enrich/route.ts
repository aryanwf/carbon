import {
  envErrorResponse,
  getSupabaseAdmin,
  requireRequestUser,
  type PaperRow,
} from "@/lib/supabase";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    .select("id,title,authors,abstract,categories,pdf_url,source_url")
    .eq("id", paperId)
    .maybeSingle();

  if (paperError) {
    return Response.json({ error: paperError.message }, { status: 500 });
  }
  if (!paperRow) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const paper = paperRow as EnrichmentPaper & Pick<PaperRow, "id">;
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

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
        send("status", { stage: "extracting" });
        const text = await extractPaperText(paper);
        send("text", { length: text.length });

        const summaryPromise = (async () => {
          send("status", { stage: "summary_started" });
          const summary = await streamSummary(
            paper,
            text,
            (chunk) => send("summary_chunk", { delta: chunk }),
            abortController.signal,
          );
          await persistSummary(paper.id, summary);
          send("summary_done", { summary });
          return summary;
        })();

        const bsPromise = (async () => {
          send("status", { stage: "bs_score_started" });
          const bs = await computeBsScore(paper, text, abortController.signal);
          await persistBsScore(paper.id, bs);
          send("bs_score", bs);
          return bs;
        })();

        const connectionsPromise = (async () => {
          send("status", { stage: "embedding_started" });
          const embedding = await computeEmbedding(
            text || paper.title || paper.id,
            abortController.signal,
          );
          await persistEmbedding(paper.id, embedding);
          send("embedding", { dimensions: embedding.length });
          send("status", { stage: "connections_started" });
          const connections = await discoverConnections(paper.id, embedding);
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
