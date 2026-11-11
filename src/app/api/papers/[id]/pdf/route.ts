import { requireRequestUser } from "@/lib/auth";
import { getBucket, getDb } from "@/lib/cloudflare";
import { envErrorResponse, internalErrorResponse } from "@/lib/http";
import { pdfObjectKey } from "@/lib/papers";

const SAFE_REQUEST_HEADERS = [
  "range",
  "if-range",
  "if-modified-since",
  "if-none-match",
];
const SAFE_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

// arXiv papers are proxied from arxiv.org. Other papers are served from the R2
// copy at pdfObjectKey(id) when one exists, falling back to proxying
// papers.pdf_url (the original upstream PDF URL).

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestUser(request);

  if (auth.response) {
    return auth.response;
  }

  const userId = auth.user.id;

  let db: D1Database;
  try {
    db = getDb();
  } catch (error) {
    return envErrorResponse(error);
  }

  const { id } = await params;
  const paperId = decodeURIComponent(id);

  let paper: { pdf_url: string | null; source_url: string | null } | null;

  try {
    paper = await db
      .prepare(
        `SELECT p.pdf_url, p.source_url
         FROM user_papers up
         JOIN papers p ON p.id = up.paper_id
         WHERE up.user_id = ?1 AND up.paper_id = ?2`,
      )
      .bind(userId, paperId)
      .first();
  } catch (error) {
    return internalErrorResponse(error, "Failed to load paper");
  }

  if (!paper) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const arxivPdfUrl =
    normalizeArxivPdf(paper.pdf_url) ?? normalizeArxivPdf(paper.source_url);

  if (!arxivPdfUrl) {
    const stored = await serveFromR2(request, paperId);
    if (stored) {
      return stored;
    }
  }

  const pdfUrl = arxivPdfUrl ?? paper.pdf_url;

  if (!pdfUrl) {
    return Response.json({ error: "No PDF URL for paper" }, { status: 404 });
  }

  return proxyUpstream(request, pdfUrl);
}

/** Serves the R2 copy (with Range/conditional support), or null if there is none. */
async function serveFromR2(request: Request, paperId: string): Promise<Response | null> {
  const bucket = getBucket();
  const key = pdfObjectKey(paperId);
  const hasRange = request.headers.has("range");
  let object: R2Object | R2ObjectBody | null;

  try {
    object = await bucket.get(key, {
      range: hasRange ? request.headers : undefined,
      onlyIf: request.headers,
    });
  } catch (error) {
    if (!hasRange) {
      console.warn("R2 PDF read failed:", error);
      return null;
    }

    // Unsatisfiable range.
    const head = await bucket.head(key).catch(() => null);
    if (!head) {
      return null;
    }
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${head.size}` },
    });
  }

  if (!object) {
    return null;
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", "application/pdf");
  headers.set("etag", object.httpEtag);
  headers.set("last-modified", object.uploaded.toUTCString());
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");

  if (!("body" in object)) {
    // A precondition failed: If-Match / If-Unmodified-Since → 412,
    // If-None-Match / If-Modified-Since → 304 (RFC 9110 §13.2.2).
    const status = failsWritePrecondition(request.headers, object) ? 412 : 304;
    return new Response(null, { status, headers });
  }

  const range = hasRange ? resolveRange(object.range, object.size) : null;

  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${object.size}`);
    headers.set("content-length", String(range.end - range.start + 1));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

function failsWritePrecondition(headers: Headers, object: R2Object) {
  const ifMatch = headers.get("if-match");

  if (ifMatch !== null) {
    const tags = ifMatch.split(",").map((tag) => tag.trim());
    return !tags.includes("*") && !tags.includes(object.httpEtag);
  }

  const ifUnmodifiedSince = Date.parse(headers.get("if-unmodified-since") ?? "");

  // HTTP dates have second precision.
  return (
    !Number.isNaN(ifUnmodifiedSince) &&
    Math.floor(object.uploaded.getTime() / 1000) * 1000 > ifUnmodifiedSince
  );
}

function resolveRange(range: R2Range | undefined, size: number) {
  if (!range || size === 0) {
    return null;
  }

  let start: number;
  let length: number;

  if ("suffix" in range) {
    length = Math.min(range.suffix, size);
    start = size - length;
  } else {
    start = range.offset ?? 0;
    length = range.length ?? size - start;
  }

  const end = Math.min(start + length, size) - 1;
  return end >= start ? { start, end } : null;
}

async function proxyUpstream(request: Request, pdfUrl: string) {
  const forwardHeaders = new Headers();
  for (const name of SAFE_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) forwardHeaders.set(name, value);
  }
  forwardHeaders.set(
    "user-agent",
    "Mozilla/5.0 (compatible; CarbonPaperProxy/1.0)",
  );
  forwardHeaders.set("accept", "application/pdf,*/*;q=0.8");

  let upstream: Response;

  try {
    upstream = await fetch(pdfUrl, {
      headers: forwardHeaders,
      redirect: "follow",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed";
    return Response.json(
      { error: `Failed to fetch PDF: ${message}`, url: pdfUrl },
      { status: 502 },
    );
  }

  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
    await upstream.body?.cancel();
    return Response.json(
      { error: `Upstream returned ${upstream.status}`, url: pdfUrl },
      { status: upstream.status },
    );
  }

  const upstreamType = upstream.headers.get("content-type") ?? "";
  if (
    upstream.status !== 304 &&
    upstreamType &&
    !upstreamType.includes("pdf") &&
    !upstreamType.includes("octet-stream")
  ) {
    await upstream.body?.cancel();
    return Response.json(
      {
        error: `Upstream returned non-PDF content (${upstreamType})`,
        url: pdfUrl,
      },
      { status: 415 },
    );
  }

  const responseHeaders = new Headers();
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("content-type", "application/pdf");
  responseHeaders.set("cache-control", "private, max-age=3600");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

function normalizeArxivPdf(url: string | null): string | null {
  if (!url) return null;

  const absMatch = url.match(/arxiv\.org\/abs\/([^?#]+)/i);
  if (absMatch) {
    return `https://arxiv.org/pdf/${absMatch[1]}.pdf`;
  }

  const pdfMatch = url.match(/arxiv\.org\/pdf\/([^?#]+?)(?:\.pdf)?$/i);
  if (pdfMatch) {
    return `https://arxiv.org/pdf/${pdfMatch[1]}.pdf`;
  }

  return null;
}
