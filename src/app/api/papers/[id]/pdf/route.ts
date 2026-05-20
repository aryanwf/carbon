import {
  envErrorResponse,
  getSupabaseAdmin,
  requireRequestUser,
} from "@/lib/supabase";

export const runtime = "nodejs";

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestUser(request);

  if (auth.response) {
    return auth.response;
  }

  const userId = auth.user.id;

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (error) {
    return envErrorResponse(error);
  }

  const { id } = await params;
  const paperId = decodeURIComponent(id);

  const { data: userPaper, error: userPaperError } = await admin
    .from("user_papers")
    .select("paper_id")
    .eq("user_id", userId)
    .eq("paper_id", paperId)
    .maybeSingle();

  if (userPaperError) {
    return Response.json({ error: userPaperError.message }, { status: 500 });
  }

  if (!userPaper) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const { data: paper, error: paperError } = await admin
    .from("papers")
    .select("pdf_url, source_url")
    .eq("id", paperId)
    .maybeSingle();

  if (paperError) {
    return Response.json({ error: paperError.message }, { status: 500 });
  }

  const pdfUrl =
    normalizeArxivPdf(paper?.pdf_url ?? null) ??
    normalizeArxivPdf(paper?.source_url ?? null) ??
    paper?.pdf_url ??
    null;

  if (!pdfUrl) {
    return Response.json({ error: "No PDF URL for paper" }, { status: 404 });
  }

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

  if (!upstream.ok && upstream.status !== 206) {
    return Response.json(
      { error: `Upstream returned ${upstream.status}`, url: pdfUrl },
      { status: upstream.status },
    );
  }

  const upstreamType = upstream.headers.get("content-type") ?? "";
  if (
    upstreamType &&
    !upstreamType.includes("pdf") &&
    !upstreamType.includes("octet-stream")
  ) {
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
