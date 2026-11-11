import { getDb, getSecret, newId, nowIso } from "@/lib/cloudflare";
import { getPaperFullText } from "@/lib/extract";
import { queryPaperNeighbors, upsertPaperVector } from "@/lib/vectors";
import type { BsScore } from "@/lib/types";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const OPENROUTER_MODEL = "openai/gpt-oss-120b:free";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const MAX_TEXT_CHARS = 15_000;
const MATCH_THRESHOLD = 0.75;
const MATCH_COUNT = 12;
const MIN_CONNECTION_STRENGTH = 0.5;

export type EnrichmentPaper = {
  id: string;
  title: string;
  authors: string[];
  abstract: string | null;
  categories: string[];
  pdf_url: string | null;
  source_url: string | null;
};

export async function extractPaperText(paper: EnrichmentPaper): Promise<string> {
  const fullText = await getPaperFullText(paper);
  if (fullText) {
    return truncate(fullText);
  }

  const fallback = [paper.title, paper.authors.join(", "), paper.abstract ?? ""]
    .filter(Boolean)
    .join("\n\n");

  return truncate(fallback);
}

function truncate(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
}

export type SummaryChunkHandler = (chunk: string) => void;

export async function streamSummary(
  paper: EnrichmentPaper,
  text: string,
  onChunk: SummaryChunkHandler,
  signal?: AbortSignal,
): Promise<string> {
  const apiKey = getSecret("OPENROUTER_API_KEY");

  const systemPrompt = `You are an expert research-paper distiller. Produce a structured Markdown summary covering:

## TL;DR
A 1-2 sentence plain-English summary.

## Problem
What problem the paper addresses.

## Method
The core approach in 3-5 sentences.

## Key Results
Bullet list of the most important findings.

## Limitations
What the paper does NOT solve.

## Why it matters
Practical or scientific implications.

Be concrete, avoid filler, prefer numbers over adjectives.`;

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Title: ${paper.title}\n\nAbstract: ${paper.abstract ?? "(none)"}\n\nPaper text:\n${text}`,
        },
      ],
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Summary stream failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  let summary = "";
  for await (const event of parseSseStream(response.body)) {
    const content = extractDelta(event);
    if (content) {
      summary += content;
      onChunk(content);
    }
  }

  return summary;
}

export async function computeBsScore(
  paper: EnrichmentPaper,
  text: string,
  signal?: AbortSignal,
): Promise<BsScore> {
  const apiKey = getSecret("OPENROUTER_API_KEY");

  const systemPrompt = `You rate research paper credibility ("BS Score"). For each dimension, score 0-100 where HIGHER = WORSE (more BS).

Dimensions and weights:
- overclaiming (30%): unsupported claims vs evidence
- rigor (25%): methodological soundness
- novelty (20%): originality vs incremental work
- credibility (15%): authors, venue, reproducibility of claims
- reproducibility (10%): code, data, clear protocol

Also produce:
- overall: weighted average of the above (rounded int)
- interesting: 0-100 score for how interesting the IDEA is (independent of execution)
- interesting_why: 1 sentence
- verdict: one short phrase, must be one of "Legit", "Solid", "Mixed", "Big if true", "Trust me bro", "BS"

Return ONLY a JSON object with EXACTLY these keys: overall, overclaiming, rigor, novelty, credibility, reproducibility, interesting, interesting_why, verdict.`;

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Title: ${paper.title}\n\nAbstract: ${paper.abstract ?? "(none)"}\n\nPaper text:\n${text}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`BS score failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = payload.choices?.[0]?.message?.content ?? "{}";
  return parseBsScore(raw);
}

function parseBsScore(raw: string): BsScore {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("BS score response is not JSON");
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  }

  const num = (key: string) => {
    const v = parsed[key];
    if (typeof v !== "number" || Number.isNaN(v)) {
      throw new Error(`BS score missing numeric field: ${key}`);
    }
    return Math.max(0, Math.min(100, Math.round(v)));
  };

  const overclaiming = num("overclaiming");
  const rigor = num("rigor");
  const novelty = num("novelty");
  const credibility = num("credibility");
  const reproducibility = num("reproducibility");
  const computedOverall = Math.round(
    overclaiming * 0.3 +
      rigor * 0.25 +
      novelty * 0.2 +
      credibility * 0.15 +
      reproducibility * 0.1,
  );

  return {
    overall:
      typeof parsed.overall === "number" && !Number.isNaN(parsed.overall)
        ? Math.max(0, Math.min(100, Math.round(parsed.overall as number)))
        : computedOverall,
    overclaiming,
    rigor,
    novelty,
    credibility,
    reproducibility,
    interesting: num("interesting"),
    interesting_why:
      typeof parsed.interesting_why === "string"
        ? parsed.interesting_why
        : undefined,
    verdict: typeof parsed.verdict === "string" ? parsed.verdict : "Mixed",
  };
}

export async function computeEmbedding(
  text: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const apiKey = getSecret("OPENROUTER_API_KEY");

  const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Embedding failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    data?: { embedding?: number[] }[];
  };
  const embedding = payload.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error("Embedding response missing vector");
  }
  return embedding;
}

export type DiscoveredConnection = {
  paper_a: string;
  paper_b: string;
  strength: number;
  relation_type: string;
};

/**
 * Finds similar papers in Vectorize and upserts paper_connections. Returns []
 * when Vectorize is unavailable (e.g. `next dev`). Neighbors whose paper row no
 * longer exists (stale vectors) are skipped by the INSERT ... SELECT.
 */
export async function discoverConnections(
  paperId: string,
  embedding: number[],
): Promise<DiscoveredConnection[]> {
  const neighbors = await queryPaperNeighbors(paperId, embedding, MATCH_COUNT);
  const matches = neighbors.filter(
    (match) =>
      match.score > MATCH_THRESHOLD && match.score >= MIN_CONNECTION_STRENGTH,
  );

  if (matches.length === 0) return [];

  const rows = matches.map((match) => {
    const [a, b] =
      paperId < match.paperId ? [paperId, match.paperId] : [match.paperId, paperId];
    return { id: newId(), a, b, s: round2(match.score) };
  });

  try {
    const { results } = await getDb()
      .prepare(
        `INSERT INTO paper_connections (id, paper_a, paper_b, strength, relation_type, created_at)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.a'),
                json_extract(value, '$.b'), json_extract(value, '$.s'), 'similar', ?2
         FROM json_each(?1)
         WHERE EXISTS (SELECT 1 FROM papers WHERE id = json_extract(value, '$.a'))
           AND EXISTS (SELECT 1 FROM papers WHERE id = json_extract(value, '$.b'))
         ON CONFLICT (paper_a, paper_b) DO UPDATE SET
           strength = excluded.strength,
           relation_type = excluded.relation_type
         RETURNING paper_a, paper_b, strength, relation_type`,
      )
      .bind(JSON.stringify(rows), nowIso())
      .all<DiscoveredConnection>();

    return results;
  } catch (error) {
    console.error("Saving connections failed:", error);
    throw new Error("Saving connections failed");
  }
}

/** Stores the paper embedding in Vectorize. Returns false if Vectorize is unavailable. */
export async function persistEmbedding(paperId: string, embedding: number[]) {
  return upsertPaperVector(paperId, embedding);
}

export async function persistSummary(paperId: string, summary: string) {
  await getDb()
    .prepare("UPDATE papers SET summary = ?1, updated_at = ?2 WHERE id = ?3")
    .bind(summary, nowIso(), paperId)
    .run();
}

export async function persistBsScore(paperId: string, bsScore: BsScore) {
  await getDb()
    .prepare("UPDATE papers SET bs_score = ?1, updated_at = ?2 WHERE id = ?3")
    .bind(JSON.stringify(bsScore), nowIso(), paperId)
    .run();
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type SseEvent = { event?: string; data: string };

async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEvent(rawEvent);
      if (parsed) yield parsed;
    }
  }
}

function parseSseEvent(raw: string): SseEvent | null {
  const lines = raw.split("\n");
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function extractDelta(event: SseEvent): string | null {
  if (event.data === "[DONE]") return null;
  try {
    const payload = JSON.parse(event.data) as {
      choices?: { delta?: { content?: string } }[];
    };
    return payload.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}
