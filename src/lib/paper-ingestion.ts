import { getDb, getOptionalSecret, nowIso, newId } from "@/lib/cloudflare";
import {
  cleanText,
  documentToMarkdown,
  extractHtmlDocument,
  fetchArxivMetadata,
  normalizeDate,
  putPaperPdf,
  readLimitedBytes,
  writeCachedPaperText,
} from "@/lib/extract";
import {
  LIBRARY_ROW_SELECT,
  libraryJoinRowToPaper,
  type LibraryJoinRow,
} from "@/lib/papers";
import type { Paper } from "@/lib/types";

const MAX_CONTEXT_CHARS = 12_000;
const OPENROUTER_MODEL = "openai/gpt-oss-120b:free";
// Each import can cost up to ~6 subrequests (page, PDF, OpenRouter, R2 x2,
// toMarkdown) and ~3 D1 queries; keep a request under the free-plan limit of
// 50 subrequests / 6 simultaneous connections.
const IMPORT_CONCURRENCY = 2;
export const MAX_IMPORT_URLS = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; CarbonPaperBot/1.0)";

type ExtractedPaper = {
  title: string;
  authors: string[];
  abstract: string | null;
  published: string | null;
  source_url: string;
  /** Upstream PDF location; uploaded copies live in R2 at pdfObjectKey(id). */
  pdf_url: string | null;
  categories: string[];
};

type MetadataGuess = {
  title?: string;
  authors?: string[];
  abstract?: string | null;
  published?: string | null;
  categories?: string[];
};

export function parseImportUrls(rawInput: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const line of rawInput.split(/\r?\n/)) {
    const url = line.trim();
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    urls.push(url);
  }

  return urls;
}

export type ImportProgressEvent =
  | { type: "start"; total: number; urls: string[] }
  | { type: "paper_start"; index: number; url: string }
  | { type: "paper_done"; index: number; url: string; paper: Paper }
  | { type: "paper_error"; index: number; url: string; error: string };

export async function importPaperUrls(
  userId: string,
  rawInput: string,
  onProgress?: (event: ImportProgressEvent) => void,
) {
  const urls = parseImportUrls(rawInput);

  if (urls.length === 0) {
    throw new Error("Valid URL is required");
  }

  if (urls.length > MAX_IMPORT_URLS) {
    throw new Error(`At most ${MAX_IMPORT_URLS} URLs can be imported at once`);
  }

  onProgress?.({ type: "start", total: urls.length, urls });

  const results: ({ ok: true; paper: Paper } | { ok: false; error: string })[] =
    new Array(urls.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= urls.length) return;
      const url = urls[index];

      onProgress?.({ type: "paper_start", index, url });

      try {
        const paper = await importPaperUrl(userId, url);
        results[index] = { ok: true, paper };
        onProgress?.({ type: "paper_done", index, url, paper });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to import paper";
        results[index] = { ok: false, error: message };
        onProgress?.({ type: "paper_error", index, url, error: message });
      }
    }
  };

  const workerCount = Math.min(IMPORT_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  const papers: Paper[] = [];
  const errors: { url: string; error: string }[] = [];

  results.forEach((result, index) => {
    if (result.ok) {
      papers.push(result.paper);
    } else {
      errors.push({ url: urls[index], error: result.error });
    }
  });

  if (papers.length === 0) {
    throw new Error(
      errors.map((entry) => `${entry.url}: ${entry.error}`).join("; "),
    );
  }

  return { papers, errors };
}

export async function importPaperUrl(userId: string, rawUrl: string) {
  const inputUrl = parseHttpUrl(rawUrl);
  const arxivId = getArxivId(inputUrl);
  const paperId = arxivId
    ? `arxiv:${stripArxivVersion(arxivId)}`
    : `url:${await hash(normalizeUrl(inputUrl))}`;
  const db = getDb();

  // Papers are shared: skip all upstream work when someone already imported it.
  const existing = await db
    .prepare("SELECT 1 AS found FROM papers WHERE id = ?1")
    .bind(paperId)
    .first<{ found: number }>()
    .catch((error: unknown) => {
      console.error("Looking up paper failed:", error);
      throw new Error("Failed to add paper to library");
    });

  const statements: D1PreparedStatement[] = [];

  if (!existing) {
    const extracted = arxivId
      ? await extractArxiv(arxivId)
      : await extractFromUrl(inputUrl, paperId);
    const now = nowIso();

    statements.push(
      db
        .prepare(
          `INSERT INTO papers
             (id, title, authors, abstract, published, source_url, pdf_url, categories, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
           ON CONFLICT (id) DO NOTHING`,
        )
        .bind(
          paperId,
          extracted.title,
          JSON.stringify(extracted.authors),
          extracted.abstract,
          extracted.published,
          extracted.source_url,
          extracted.pdf_url,
          JSON.stringify(extracted.categories),
          now,
        ),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO user_papers (id, user_id, paper_id, added_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (user_id, paper_id) DO NOTHING`,
      )
      .bind(newId(), userId, paperId, nowIso()),
    db
      .prepare(`${LIBRARY_ROW_SELECT} WHERE up.user_id = ?1 AND up.paper_id = ?2`)
      .bind(userId, paperId),
  );

  const results = await db.batch(statements).catch((error: unknown) => {
    console.error("Saving imported paper failed:", error);
    throw new Error("Failed to add paper to library");
  });
  const row = results.at(-1)?.results[0] as LibraryJoinRow | undefined;

  if (!row) {
    throw new Error("Failed to add paper to library");
  }

  return libraryJoinRowToPaper(row);
}

async function extractArxiv(arxivId: string): Promise<ExtractedPaper> {
  // arXiv PDFs are proxied from arxiv.org by /api/papers/[id]/pdf, so nothing
  // is downloaded or stored at import time.
  const metadata = await fetchArxivMetadata(arxivId);

  return {
    ...metadata,
    source_url: new URL(`/abs/${arxivId}`, "https://arxiv.org").toString(),
    pdf_url: new URL(`/pdf/${arxivId}`, "https://arxiv.org").toString(),
  };
}

async function extractFromUrl(inputUrl: URL, paperId: string): Promise<ExtractedPaper> {
  const response = await fetch(inputUrl, {
    headers: {
      Accept: "text/html,application/pdf;q=0.9,*/*;q=0.8",
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Failed to fetch URL (${response.status})`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/pdf") || inputUrl.pathname.endsWith(".pdf")) {
    const text = await storePdfAndExtractText(paperId, response);
    const [guess] = await Promise.all([
      guessMetadata(text ?? "", inputUrl),
      text ? writeCachedPaperText(paperId, text) : Promise.resolve(),
    ]);

    return {
      title: cleanText(guess.title) || titleFromUrl(inputUrl),
      authors: normalizeStringArray(guess.authors),
      abstract: cleanText(guess.abstract) || null,
      published: normalizeDate(guess.published),
      source_url: inputUrl.toString(),
      pdf_url: inputUrl.toString(),
      categories: normalizeStringArray(guess.categories),
    };
  }

  const metadata = await extractHtmlDocument(response, inputUrl);
  const [guess] = await Promise.all([
    guessMetadata(metadata.text, inputUrl),
    metadata.pdfSourceUrl
      ? storeOptionalPdf(paperId, metadata.pdfSourceUrl)
      : Promise.resolve(),
  ]);
  const guessedAuthors = normalizeStringArray(guess.authors);
  const guessedCategories = normalizeStringArray(guess.categories);

  return {
    title: cleanText(guess.title) || metadata.title || titleFromUrl(inputUrl),
    authors: guessedAuthors.length > 0 ? guessedAuthors : metadata.authors,
    abstract: cleanText(guess.abstract) || metadata.abstract,
    published: normalizeDate(guess.published) ?? metadata.published,
    source_url: inputUrl.toString(),
    pdf_url: metadata.pdfSourceUrl,
    categories: guessedCategories.length > 0 ? guessedCategories : metadata.categories,
  };
}

/** One buffer feeds both the R2 upload and toMarkdown; it is released on return. */
async function storePdfAndExtractText(paperId: string, response: Response) {
  const pdfBytes = await readLimitedBytes(response);
  const [, text] = await Promise.all([
    putPaperPdf(paperId, pdfBytes),
    documentToMarkdown(pdfBytes, "application/pdf"),
  ]);
  return text;
}

async function guessMetadata(text: string, sourceUrl: URL): Promise<MetadataGuess> {
  const apiKey = getOptionalSecret("OPENROUTER_API_KEY");

  if (!apiKey || text.trim().length === 0) {
    return {};
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract research paper metadata. Return JSON with title, authors, abstract, published, categories. Use null or [] when unknown.",
        },
        {
          role: "user",
          content: `Source URL: ${sourceUrl.toString()}\n\nContent:\n${text.slice(
            0,
            MAX_CONTEXT_CHARS,
          )}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Metadata inference failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    return {};
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as MetadataGuess) : {};
  } catch {
    return {};
  }
}

/** Best-effort copy of a linked PDF into R2; failures are ignored. */
async function storeOptionalPdf(paperId: string, url: string) {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/pdf", "User-Agent": USER_AGENT },
    });

    if (
      !response.ok ||
      !(response.headers.get("content-type") ?? "").includes("application/pdf")
    ) {
      await response.body?.cancel();
      return;
    }

    await putPaperPdf(paperId, await readLimitedBytes(response));
  } catch (error) {
    console.warn("Storing linked PDF failed:", error);
  }
}

function getArxivId(url: URL) {
  if (!url.hostname.endsWith("arxiv.org")) {
    return null;
  }

  const match = url.pathname.match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function stripArxivVersion(id: string) {
  return id.replace(/v\d+$/i, "");
}

function parseHttpUrl(rawUrl: string) {
  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Valid URL is required");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) URLs can be imported");
  }

  return url;
}

function normalizeUrl(url: URL) {
  const normalized = new URL(url);
  normalized.hash = "";

  if (normalized.pathname !== "/") {
    normalized.pathname = normalized.pathname.replace(/\/+$/, "");
  }

  return normalized.toString();
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(cleanText).filter((item): item is string => item.length > 0)
    : [];
}

function titleFromUrl(url: URL) {
  const lastPath = url.pathname.split("/").filter(Boolean).at(-1);
  const title = lastPath ? decodeURIComponent(lastPath) : url.hostname;
  return title.replace(/\.[a-z0-9]+$/i, "").replaceAll(/[-_]+/g, " ");
}

/** First 24 hex chars of SHA-256 (same ids as the old node:crypto version). */
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}
