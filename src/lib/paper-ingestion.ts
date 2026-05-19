import { createHash } from "node:crypto";
import { load } from "cheerio";
import {
  getSupabaseAdmin,
  mergePaperRows,
  type PaperRow,
  type UserPaperRow,
} from "@/lib/supabase";
import type { Paper } from "@/lib/types";

const PAPERS_BUCKET = "papers";
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_CONTEXT_CHARS = 12_000;
const OPENROUTER_MODEL = "openai/gpt-oss-120b";

type ExtractedPaper = {
  id: string;
  title: string;
  authors: string[];
  abstract: string | null;
  published: string | null;
  source_url: string;
  pdfSourceUrl: string | null;
  categories: string[];
  pdfBytes: Buffer | null;
};

type MetadataGuess = {
  title?: string;
  authors?: string[];
  abstract?: string | null;
  published?: string | null;
  categories?: string[];
};

export async function importPaperUrl(userId: string, rawUrl: string) {
  const inputUrl = parseHttpUrl(rawUrl);
  const extracted = await extractPaper(inputUrl);
  const supabaseAdmin = getSupabaseAdmin();
  const existingPaper = await getPaperRow(extracted.id);
  const paperRow =
    existingPaper ??
    (await insertPaperRow({
      id: extracted.id,
      title: extracted.title,
      authors: extracted.authors,
      abstract: extracted.abstract,
      published: extracted.published,
      source_url: extracted.source_url,
      pdf_url: extracted.pdfBytes
        ? await uploadPdf(extracted.id, extracted.pdfBytes)
        : extracted.pdfSourceUrl,
      categories: extracted.categories,
    }));

  const { error: linkError } = await supabaseAdmin.from("user_papers").upsert(
    {
      user_id: userId,
      paper_id: paperRow.id,
    },
    { onConflict: "user_id,paper_id", ignoreDuplicates: true },
  );

  if (linkError) {
    throw new Error(linkError.message);
  }

  const userPaper = await getUserPaperRow(userId, paperRow.id);

  return mergePaperRows(paperRow, userPaper);
}

async function extractPaper(inputUrl: URL): Promise<ExtractedPaper> {
  const arxivId = getArxivId(inputUrl);

  if (arxivId) {
    return scrapeArxiv(inputUrl, arxivId);
  }

  const response = await fetch(inputUrl, {
    headers: { Accept: "text/html,application/pdf;q=0.9,*/*;q=0.8" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL (${response.status})`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/pdf") || inputUrl.pathname.endsWith(".pdf")) {
    const pdfBytes = await readPdfBytes(response);
    const text = await extractPdfText(pdfBytes);
    const guess = await guessMetadata(text, inputUrl);
    const title = cleanText(guess.title) || titleFromUrl(inputUrl);

    return {
      id: `url:${hash(normalizeUrl(inputUrl))}`,
      title,
      authors: normalizeStringArray(guess.authors),
      abstract: cleanText(guess.abstract) || null,
      published: normalizeDate(guess.published),
      source_url: inputUrl.toString(),
      pdfSourceUrl: inputUrl.toString(),
      categories: normalizeStringArray(guess.categories),
      pdfBytes,
    };
  }

  const html = await response.text();
  const metadata = extractHtmlMetadata(html, inputUrl);
  const pageText = htmlToText(html);
  const guess = await guessMetadata(pageText, inputUrl);
  const pdfSourceUrl = metadata.pdfSourceUrl;
  const pdfBytes = pdfSourceUrl ? await fetchOptionalPdf(pdfSourceUrl) : null;

  return {
    id: `url:${hash(normalizeUrl(inputUrl))}`,
    title: cleanText(guess.title) || metadata.title || titleFromUrl(inputUrl),
    authors:
      normalizeStringArray(guess.authors).length > 0
        ? normalizeStringArray(guess.authors)
        : metadata.authors,
    abstract: cleanText(guess.abstract) || metadata.abstract,
    published: normalizeDate(guess.published) ?? metadata.published,
    source_url: inputUrl.toString(),
    pdfSourceUrl,
    categories:
      normalizeStringArray(guess.categories).length > 0
        ? normalizeStringArray(guess.categories)
        : metadata.categories,
    pdfBytes,
  };
}

async function scrapeArxiv(inputUrl: URL, arxivId: string): Promise<ExtractedPaper> {
  const absUrl = new URL(`/abs/${arxivId}`, "https://arxiv.org");
  const pdfUrl = new URL(`/pdf/${arxivId}`, "https://arxiv.org");
  const [htmlResponse, pdfResponse] = await Promise.all([
    fetch(absUrl, { headers: { Accept: "text/html" } }),
    fetch(pdfUrl, { headers: { Accept: "application/pdf" } }),
  ]);

  if (!htmlResponse.ok) {
    throw new Error(`Failed to fetch arXiv metadata (${htmlResponse.status})`);
  }

  const html = await htmlResponse.text();
  const $ = load(html);
  const title =
    cleanText($("h1.title").text().replace(/^Title:\s*/i, "")) ||
    cleanText($('meta[name="citation_title"]').attr("content")) ||
    `arXiv ${arxivId}`;
  const authors = $("div.authors a")
    .map((_, element) => cleanText($(element).text()))
    .get()
    .filter(Boolean);
  const abstract =
    cleanText($("blockquote.abstract").text().replace(/^Abstract:\s*/i, "")) ||
    null;
  const categories = $("td.tablecell.subjects .primary-subject")
    .map((_, element) => cleanText($(element).text()))
    .get()
    .filter(Boolean);
  const published =
    normalizeDate($('meta[name="citation_date"]').attr("content")) ??
    normalizeDate($("div.dateline").text().replace(/[()]/g, ""));
  const pdfBytes = pdfResponse.ok ? await readPdfBytes(pdfResponse) : null;

  return {
    id: `arxiv:${stripArxivVersion(arxivId)}`,
    title,
    authors,
    abstract,
    published,
    source_url: absUrl.toString(),
    pdfSourceUrl: pdfUrl.toString(),
    categories,
    pdfBytes,
  };
}

async function guessMetadata(
  text: string,
  sourceUrl: URL,
): Promise<MetadataGuess> {
  const apiKey = process.env.OPENROUTER_API_KEY;

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
    return JSON.parse(content) as MetadataGuess;
  } catch {
    return {};
  }
}

function extractHtmlMetadata(html: string, sourceUrl: URL) {
  const $ = load(html);
  const title =
    cleanText($('meta[name="citation_title"]').attr("content")) ||
    cleanText($('meta[property="og:title"]').attr("content")) ||
    cleanText($("title").text());
  const authors = $('meta[name="citation_author"]')
    .map((_, element) => cleanText($(element).attr("content")))
    .get()
    .filter(Boolean);
  const abstract =
    cleanText($('meta[name="citation_abstract"]').attr("content")) ||
    cleanText($('meta[name="description"]').attr("content")) ||
    cleanText($('meta[property="og:description"]').attr("content")) ||
    null;
  const published =
    normalizeDate($('meta[name="citation_publication_date"]').attr("content")) ??
    normalizeDate($('meta[name="citation_online_date"]').attr("content")) ??
    normalizeDate($('meta[property="article:published_time"]').attr("content"));
  const categories = $('meta[name="citation_keywords"]')
    .map((_, element) => cleanText($(element).attr("content")))
    .get()
    .flatMap((value) => value.split(/[;,]/))
    .map(cleanText)
    .filter(Boolean);
  const pdfHref =
    cleanText($('meta[name="citation_pdf_url"]').attr("content")) ||
    cleanText($('a[href$=".pdf"]').first().attr("href"));

  return {
    title,
    authors,
    abstract,
    published,
    categories,
    pdfSourceUrl: pdfHref ? new URL(pdfHref, sourceUrl).toString() : null,
  };
}

async function extractPdfText(pdfBytes: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(pdfBytes) });

  try {
    const result = await parser.getText({ first: 8 });
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function uploadPdf(paperId: string, pdfBytes: Buffer) {
  const supabaseAdmin = getSupabaseAdmin();
  const bucket = supabaseAdmin.storage.from(PAPERS_BUCKET);
  const bucketInfo = await supabaseAdmin.storage.getBucket(PAPERS_BUCKET);

  if (bucketInfo.error) {
    const { error } = await supabaseAdmin.storage.createBucket(PAPERS_BUCKET, {
      public: true,
    });

    if (error && !error.message.toLowerCase().includes("already exists")) {
      throw new Error(error.message);
    }
  }

  const path = `${paperId.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
  const { error } = await bucket.upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  return bucket.getPublicUrl(path).data.publicUrl;
}

async function insertPaperRow(row: PaperRow) {
  const { data, error } = await getSupabaseAdmin()
    .from("papers")
    .insert(row)
    .select(
      "id,title,authors,abstract,published,source_url,pdf_url,categories",
    )
    .single();

  if (error) {
    if (error.code === "23505") {
      const existing = await getPaperRow(row.id);

      if (existing) {
        return existing;
      }
    }

    throw new Error(error.message);
  }

  return data as PaperRow;
}

async function getPaperRow(id: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("papers")
    .select(
      "id,title,authors,abstract,published,source_url,pdf_url,categories",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as PaperRow | null) ?? null;
}

async function getUserPaperRow(userId: string, paperId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("user_papers")
    .select("*")
    .eq("user_id", userId)
    .eq("paper_id", paperId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as UserPaperRow;
}

async function readPdfBytes(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);

  if (contentLength > MAX_PDF_BYTES) {
    throw new Error("PDF exceeds 30MB import limit");
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error("PDF exceeds 30MB import limit");
  }

  return bytes;
}

async function fetchOptionalPdf(url: string) {
  const response = await fetch(url, { headers: { Accept: "application/pdf" } });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/pdf")) {
    return null;
  }

  return readPdfBytes(response);
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

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(cleanText).filter((item): item is string => item.length > 0)
    : [];
}

function htmlToText(html: string) {
  const $ = load(html);
  $("script,style,noscript,svg").remove();
  return cleanText($("body").text() || $.text()).slice(0, MAX_CONTEXT_CHARS);
}

function titleFromUrl(url: URL) {
  const lastPath = url.pathname.split("/").filter(Boolean).at(-1);
  const title = lastPath ? decodeURIComponent(lastPath) : url.hostname;
  return title.replace(/\.[a-z0-9]+$/i, "").replaceAll(/[-_]+/g, " ");
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
