import { isSameOrigin } from "@/lib/auth";
import {
  clearSessionCookie,
  isSecureUrl,
  readCookie,
  SESSION_COOKIE,
} from "@/lib/auth/cookies";
import { deleteSession } from "@/lib/auth/session";
import { getDb } from "@/lib/cloudflare";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const requestUrl = new URL(request.url);

  try {
    await deleteSession(getDb(), readCookie(request.headers.get("cookie"), SESSION_COOKIE));
  } catch (error) {
    // Still clear the cookie; an orphaned row expires on its own.
    console.error("Failed to delete session", error);
  }

  const headers = new Headers({
    "Set-Cookie": clearSessionCookie(isSecureUrl(requestUrl)),
    "Cache-Control": "no-store",
  });

  // Plain form posts navigate; fetch() callers get 204.
  if (request.headers.get("sec-fetch-mode") === "navigate") {
    headers.set("Location", `${requestUrl.origin}/`);
    return new Response(null, { status: 303, headers });
  }

  return new Response(null, { status: 204, headers });
}
