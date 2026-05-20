import type { BsScore } from "@/lib/types";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "openai/gpt-oss-120b:free";
const MAX_PAPER_TEXT_CHARS = 12_000;
const MAX_LIBRARY_TITLES = 25;

export type ChatRole = "user" | "assistant";

export type ChatTurn = {
  role: ChatRole;
  content: string;
};

export type ChatPaperContext = {
  id: string;
  title: string;
  authors: string[];
  abstract: string | null;
  categories: string[];
  summary: string | null;
  bs_score: BsScore | null;
  paper_text: string;
};

export type ChatLibraryEntry = {
  id: string;
  title: string;
  categories: string[];
};

export function buildSystemPrompt(
  paper: ChatPaperContext,
  library: ChatLibraryEntry[],
): string {
  const bs = paper.bs_score;
  const bsBlock = bs
    ? [
        `Legitness: ${100 - bs.overall}/100 (verdict: ${bs.verdict})`,
        `Interesting: ${bs.interesting}/100${bs.interesting_why ? ` — ${bs.interesting_why}` : ""}`,
        `Breakdown — overclaiming:${bs.overclaiming}, rigor:${bs.rigor}, novelty:${bs.novelty}, credibility:${bs.credibility}, reproducibility:${bs.reproducibility}`,
      ].join("\n")
    : "(no BS score yet)";

  const libraryBlock = library.length
    ? library
        .slice(0, MAX_LIBRARY_TITLES)
        .map((entry) => {
          const cats = entry.categories.slice(0, 3).join(", ");
          return `- ${entry.title}${cats ? ` [${cats}]` : ""}`;
        })
        .join("\n")
    : "(library empty)";

  const paperText = paper.paper_text.slice(0, MAX_PAPER_TEXT_CHARS);

  return `You are Carbon's research assistant for one specific paper. Answer the user's questions about it accurately and concretely.

Ground every claim in the paper text below. If the answer is not in the paper, say so explicitly. Prefer numbers, equations, and direct quotes (use Markdown blockquotes) over vague summaries.

Use Markdown formatting. For LaTeX, follow these rules strictly because the renderer only supports Streamdown/KaTeX math:
- Inline math: wrap the expression in double dollar signs on the same line, like $$E = mc^2$$.
- Display math: put opening and closing double dollar signs on their own lines:
$$
\int_a^b f(x) \, dx
$$
- Never use \\(...\\), \\[...\\], single-dollar math, or raw LaTeX environments outside $$ blocks.
- Keep math delimiters balanced. If unsure, write the expression as plain text instead of malformed LaTeX.

When you cite a passage from the paper, mark it like [paper]. When you reference another paper the user has in their library, use [lib: <short title>]. Never invent citations.

Be concise but technically rigorous. Push back politely if the user's framing is wrong.

--- PAPER ---
Title: ${paper.title}
Authors: ${paper.authors.join(", ") || "Unknown"}
Categories: ${paper.categories.join(", ") || "Uncategorized"}

Abstract:
${paper.abstract || "(none)"}

AI summary:
${paper.summary || "(not yet generated)"}

Credibility:
${bsBlock}

Paper text (truncated):
${paperText || "(extraction failed)"}

--- USER LIBRARY (for cross-reference) ---
${libraryBlock}`;
}

export type ChatChunkHandler = (chunk: string) => void;

export async function streamChat(
  systemPrompt: string,
  history: ChatTurn[],
  onChunk: ChatChunkHandler,
  signal?: AbortSignal,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");

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
      messages: [{ role: "system", content: systemPrompt }, ...history],
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Chat stream failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  let full = "";
  const reader = response.body.getReader();
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
      const delta = extractSseDelta(rawEvent);
      if (delta) {
        full += delta;
        onChunk(delta);
      }
    }
  }

  return full;
}

function extractSseDelta(raw: string): string | null {
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return null;
  try {
    const payload = JSON.parse(data) as {
      choices?: { delta?: { content?: string } }[];
    };
    return payload.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}
