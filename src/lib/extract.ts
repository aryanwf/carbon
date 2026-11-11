import { getAI, getBucket } from "@/lib/cloudflare";
import { pdfObjectKey, textObjectKey } from "@/lib/papers";

// Text extraction is offloaded to Workers AI (toMarkdown) and the runtime's
// native HTMLRewriter so the Worker itself stays well under the CPU budget.

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PDF_LABEL = `${MAX_PDF_BYTES / (1024 * 1024)}MB`;
/** Upper bound for cached full text; readers truncate further. */
const MAX_CACHED_TEXT_CHARS = 60_000;
/** Upper bound for visible page text collected from HTML imports. */
const MAX_PAGE_TEXT_CHARS = 12_000;
const USER_AGENT = "Mozilla/5.0 (compatible; CarbonPaperBot/1.0)";

export type PaperTextSource = {
  id: string;
  pdf_url: string | null;
  source_url: string | null;
};

// Workers AI toMarkdown ----------------------------------------------------

export async function documentToMarkdown(
  data: ArrayBuffer | Uint8Array<ArrayBuffer> | string,
  mimeType: "application/pdf" | "text/html",
): Promise<string | null> {
  try {
    const [result] = await getAI().toMarkdown(
      [
        {
          name: mimeType === "application/pdf" ? "paper.pdf" : "paper.html",
          blob: new Blob([data], { type: mimeType }),
        },
      ],
      {
        conversionOptions: {
          html: { images: { convert: false } },
          pdf: { images: { convert: false } },
        },
      },
    );

    if (!result || result.format === "error") {
      console.warn(
        "toMarkdown failed:",
        result && "error" in result ? result.error : "no result",
      );
      return null;
    }

    const text = result.data.trim();
    return text ? text.slice(0, MAX_CACHED_TEXT_CHARS) : null;
  } catch (error) {
    console.warn("toMarkdown unavailable:", error);
    return null;
  }
}

// Full-text cache in R2 ---------------------------------------------------

export async function readCachedPaperText(paperId: string): Promise<string | null> {
  try {
    const object = await getBucket().get(textObjectKey(paperId));
    return object ? await object.text() : null;
  } catch (error) {
    console.warn("Reading cached paper text failed:", error);
    return null;
  }
}

export async function writeCachedPaperText(paperId: string, text: string) {
  try {
    await getBucket().put(textObjectKey(paperId), text.slice(0, MAX_CACHED_TEXT_CHARS), {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    console.warn("Caching paper text failed:", error);
  }
}

export async function putPaperPdf(paperId: string, bytes: Uint8Array<ArrayBuffer>) {
  await getBucket().put(pdfObjectKey(paperId), bytes, {
    httpMetadata: { contentType: "application/pdf" },
  });
}

/**
 * Full text of a paper as Markdown (untruncated up to the cache limit), or null
 * if nothing could be extracted. Order: R2 cache → arXiv HTML → PDF (R2 copy,
 * then upstream URL). Successful extractions are cached in R2.
 */
export async function getPaperFullText(paper: PaperTextSource): Promise<string | null> {
  const cached = await readCachedPaperText(paper.id);
  if (cached) {
    return cached;
  }

  const text = await extractPaperFullText(paper);
  if (text) {
    await writeCachedPaperText(paper.id, text);
  }

  return text;
}

async function extractPaperFullText(paper: PaperTextSource): Promise<string | null> {
  const arxivId = paper.id.startsWith("arxiv:") ? paper.id.slice("arxiv:".length) : null;

  if (arxivId) {
    const html = await fetchText(`https://arxiv.org/html/${arxivId}`, "text/html");
    const text = html ? await documentToMarkdown(html, "text/html") : null;
    if (text) {
      return text;
    }
  }

  const pdf = await loadPaperPdf(paper, arxivId);
  return pdf ? documentToMarkdown(pdf, "application/pdf") : null;
}

async function loadPaperPdf(
  paper: PaperTextSource,
  arxivId: string | null,
): Promise<ArrayBuffer | Uint8Array<ArrayBuffer> | null> {
  if (!arxivId) {
    try {
      const object = await getBucket().get(pdfObjectKey(paper.id));
      if (object) {
        return await object.arrayBuffer();
      }
    } catch (error) {
      console.warn("Reading PDF from R2 failed:", error);
    }
  }

  const url = arxivId ? `https://arxiv.org/pdf/${arxivId}` : paper.pdf_url;
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/pdf", "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return await readLimitedBytes(response);
  } catch {
    return null;
  }
}

async function fetchText(url: string, accept: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: accept, "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Reads a PDF response body incrementally, enforcing MAX_PDF_BYTES without
 * buffering more than the limit.
 */
export async function readLimitedBytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = () => new Error(`PDF exceeds ${MAX_PDF_LABEL} import limit`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);

  if (contentLength > MAX_PDF_BYTES) {
    await response.body?.cancel();
    throw tooLarge();
  }

  if (!response.body) {
    throw new Error("PDF response has no body");
  }

  const reader = response.body.getReader();
  // Preallocate when the size is announced so chunks are copied exactly once.
  let buffer: Uint8Array<ArrayBuffer> | null =
    contentLength > 0 && Number.isFinite(contentLength) ? new Uint8Array(contentLength) : null;
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (received + value.byteLength > MAX_PDF_BYTES) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }

    if (buffer && received + value.byteLength <= buffer.byteLength) {
      buffer.set(value, received);
    } else {
      if (buffer) {
        // Body is longer than announced: fall back to collecting chunks.
        chunks.push(buffer.subarray(0, received));
        buffer = null;
      }
      chunks.push(value);
    }
    received += value.byteLength;
  }

  if (buffer) {
    return received === buffer.byteLength ? buffer : buffer.subarray(0, received);
  }

  if (chunks.length === 1) {
    return chunks[0] as Uint8Array<ArrayBuffer>;
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// HTML metadata -----------------------------------------------------------

export type HtmlDocumentInfo = {
  title: string;
  authors: string[];
  abstract: string | null;
  published: string | null;
  categories: string[];
  pdfSourceUrl: string | null;
  /** Visible body text, whitespace-collapsed and truncated. */
  text: string;
};

type RawHtmlInfo = {
  meta: Map<string, string[]>;
  title: string;
  firstPdfHref: string | null;
  text: string;
};

/** Extracts citation/OpenGraph metadata and visible text from an HTML response. */
export async function extractHtmlDocument(
  response: Response,
  sourceUrl: URL,
): Promise<HtmlDocumentInfo> {
  const raw =
    typeof HTMLRewriter === "undefined"
      ? scanHtmlWithRegex(await response.text())
      : await scanHtmlWithRewriter(response);

  const first = (name: string) => cleanText(decodeEntities(raw.meta.get(name)?.[0] ?? ""));
  const all = (name: string) =>
    (raw.meta.get(name) ?? []).map((v) => cleanText(decodeEntities(v))).filter(Boolean);

  const pdfHref = first("citation_pdf_url") || cleanText(decodeEntities(raw.firstPdfHref ?? ""));
  let pdfSourceUrl: string | null = null;
  if (pdfHref) {
    try {
      pdfSourceUrl = new URL(pdfHref, sourceUrl).toString();
    } catch {
      pdfSourceUrl = null;
    }
  }

  return {
    title:
      first("citation_title") ||
      first("og:title") ||
      cleanText(decodeEntities(raw.title)),
    authors: all("citation_author"),
    abstract:
      first("citation_abstract") || first("description") || first("og:description") || null,
    published:
      normalizeDate(first("citation_publication_date")) ??
      normalizeDate(first("citation_online_date")) ??
      normalizeDate(first("article:published_time")),
    categories: all("citation_keywords")
      .flatMap((value) => value.split(/[;,]/))
      .map(cleanText)
      .filter(Boolean),
    pdfSourceUrl,
    text: cleanText(decodeEntities(raw.text)).slice(0, MAX_PAGE_TEXT_CHARS),
  };
}

const SKIPPED_TEXT_TAGS = ["script", "style", "noscript", "svg", "template"];

async function scanHtmlWithRewriter(response: Response): Promise<RawHtmlInfo> {
  const info: RawHtmlInfo = { meta: new Map(), title: "", firstPdfHref: null, text: "" };
  let inBody = false;
  let skipDepth = 0;
  // Raw chunks can include entities/whitespace, so allow some slack.
  const textBudget = MAX_PAGE_TEXT_CHARS * 2;

  let rewriter = new HTMLRewriter()
    .on("meta", {
      element(element) {
        const key = (element.getAttribute("name") ?? element.getAttribute("property"))
          ?.trim()
          .toLowerCase();
        const content = element.getAttribute("content");
        if (key && content) {
          const list = info.meta.get(key) ?? [];
          list.push(content);
          info.meta.set(key, list);
        }
      },
    })
    .on("title", {
      text(chunk) {
        if (info.title.length < 1_000) info.title += chunk.text;
      },
    })
    .on('a[href$=".pdf"]', {
      element(element) {
        info.firstPdfHref ??= element.getAttribute("href");
      },
    })
    .on("body", {
      element() {
        inBody = true;
      },
    });

  for (const tag of SKIPPED_TEXT_TAGS) {
    rewriter = rewriter.on(tag, {
      element(element) {
        skipDepth++;
        try {
          element.onEndTag(() => {
            skipDepth--;
          });
        } catch {
          skipDepth--;
        }
      },
    });
  }

  rewriter = rewriter.onDocument({
    text(chunk) {
      if (inBody && skipDepth === 0 && info.text.length < textBudget) {
        info.text += chunk.text;
        if (chunk.lastInTextNode) info.text += " ";
      }
    },
  });

  await rewriter.transform(response).body?.pipeTo(new WritableStream());
  return info;
}

/** Fallback for `next dev` (Node), where HTMLRewriter is not available. */
function scanHtmlWithRegex(html: string): RawHtmlInfo {
  const meta = new Map<string, string[]>();

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const key = (attrs.name ?? attrs.property)?.trim().toLowerCase();
    if (key && attrs.content) {
      const list = meta.get(key) ?? [];
      list.push(attrs.content);
      meta.set(key, list);
    }
  }

  let firstPdfHref: string | null = null;
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = parseAttributes(match[0]).href;
    if (href && href.endsWith(".pdf")) {
      firstPdfHref = href;
      break;
    }
  }

  const body = html.match(/<body\b[^>]*>([\s\S]*)$/i)?.[1] ?? html;
  const text = body
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .slice(0, MAX_PAGE_TEXT_CHARS * 2);

  return {
    meta,
    title: html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
    firstPdfHref,
    text,
  };
}

function parseAttributes(tag: string) {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

// arXiv metadata (Atom API) -----------------------------------------------

export type ArxivMetadata = {
  title: string;
  authors: string[];
  abstract: string | null;
  published: string | null;
  categories: string[];
};

export async function fetchArxivMetadata(arxivId: string): Promise<ArxivMetadata> {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(
    arxivId,
  )}&max_results=1`;
  const response = await fetch(url, {
    headers: { Accept: "application/atom+xml", "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Failed to fetch arXiv metadata (${response.status})`);
  }

  const xml = await response.text();
  const entry = xml.match(/<entry\b[^>]*>([\s\S]*?)<\/entry>/i)?.[1];
  const entryId = entry ? xmlText(entry, "id") : "";

  if (!entry || entryId.includes("/api/errors")) {
    throw new Error("Failed to fetch arXiv metadata (paper not found)");
  }

  const authors = Array.from(
    entry.matchAll(/<author\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/gi),
    (match) => cleanText(decodeEntities(match[1])),
  ).filter(Boolean);
  const primaryCategory =
    entry.match(/<arxiv:primary_category\b[^>]*\bterm="([^"]+)"/i)?.[1] ??
    entry.match(/<category\b[^>]*\bterm="([^"]+)"/i)?.[1] ??
    null;

  return {
    title: xmlText(entry, "title") || `arXiv ${arxivId}`,
    authors,
    abstract: xmlText(entry, "summary") || null,
    published: normalizeDate(xmlText(entry, "published")),
    categories: primaryCategory ? [decodeEntities(primaryCategory)] : [],
  };
}

function xmlText(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return cleanText(decodeEntities(match?.[1] ?? ""));
}

// Shared text helpers -----------------------------------------------------

export function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function normalizeDate(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string) {
  if (!value.includes("&")) {
    return value;
  }

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}
