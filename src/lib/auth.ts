/*
 * Auth (Google OAuth, sessions in D1, HttpOnly cookie).
 *
 * Usage in route handlers:
 *     const auth = await requireRequestUser(request);
 *     if (auth.response) return auth.response;
 *     auth.user // AuthenticatedRequestUser
 * - Identity comes from the `carbon_session` cookie (same-origin fetch sends
 *   it automatically).
 * - requireRequestUser also enforces same-origin on non-GET/HEAD/OPTIONS
 *   requests (CSRF) and returns 403 on mismatch. Ban check behaviour is
 *   unchanged (403 { error: "Account banned", reason }).
 * - `username` and `display_name` are non-null: `username` is profiles.username
 *   (sign-in guarantees the profile row exists), `display_name` falls back to
 *   users.name, then the email local part. `id` is users.id (= profiles.id).
 * - getRequestUser/getCurrentUser return null for missing/expired sessions and
 *   do NOT check bans.
 */

import { cookies, headers } from "next/headers";
import { getDb } from "@/lib/cloudflare";
import {
  isSecureHost,
  isSecureUrl,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/cookies";
import { validateSession, type ValidatedSession } from "@/lib/auth/session";

export type AuthenticatedRequestUser = {
  id: string;
  email: string | null;
  username: string;
  display_name: string;
  avatar_url: string | null;
};

/** Shape passed from server components to the client (e.g. AuthProvider). */
export type SessionUser = AuthenticatedRequestUser;

export type AuthenticatedRequest =
  | { user: AuthenticatedRequestUser; response?: never }
  | { user?: never; response: Response };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * For route handlers: reads the session cookie from the Request, validates the
 * session in D1, enforces same-origin for non-GET/HEAD (CSRF) and checks bans.
 * Returns the user, or a Response (401 unauthenticated, 403 banned/cross-origin).
 */
export async function requireRequestUser(
  request: Request,
): Promise<AuthenticatedRequest> {
  if (!SAFE_METHODS.has(request.method.toUpperCase()) && !isSameOrigin(request)) {
    return {
      response: Response.json({ error: "Cross-origin request rejected" }, { status: 403 }),
    };
  }

  let session: ValidatedSession | null;

  try {
    session = await validateRequestSession(request, { checkBan: true });
  } catch (error) {
    console.error("Authorization check failed:", error);
    return {
      response: Response.json({ error: "Authorization check failed" }, { status: 500 }),
    };
  }

  if (!session) {
    return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { user, bannedReason } = session;

  if (bannedReason !== null) {
    return {
      response: Response.json(
        { error: "Account banned", reason: bannedReason },
        { status: 403 },
      ),
    };
  }

  return { user };
}

/** For route handlers: the signed-in user or null. No ban/CSRF checks. */
export async function getRequestUser(
  request: Request,
): Promise<AuthenticatedRequestUser | null> {
  return (await validateRequestSession(request))?.user ?? null;
}

/** Route handlers can set cookies, so the session is renewed when due. */
async function validateRequestSession(
  request: Request,
  options: { checkBan?: boolean } = {},
): Promise<ValidatedSession | null> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);

  if (!token) {
    return null;
  }

  const session = await validateSession(getDb(), token, { ...options, renew: true });

  if (session?.renewed) {
    await refreshSessionCookie(token, isSecureUrl(request.url));
  }

  return session;
}

/**
 * For server components / server actions: reads the cookie via next/headers.
 * No ban check. Pass `renew: true` only from server actions: server
 * components cannot set cookies, so they never extend the session.
 */
export async function getCurrentUser(
  options: { renew?: boolean } = {},
): Promise<AuthenticatedRequestUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const session = await validateSession(getDb(), token, { renew: options.renew });

  if (!session) {
    return null;
  }

  if (session.renewed) {
    const host = (await headers()).get("host");
    await refreshSessionCookie(token, isSecureHost(host));
  }

  return session.user;
}

/**
 * CSRF check: the Origin header must match the request origin. Without an
 * Origin header, accept Sec-Fetch-Site: same-origin or a same-origin Referer.
 */
export function isSameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");

  if (origin !== null) {
    return origin === expected;
  }

  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite !== null) {
    return fetchSite === "same-origin";
  }

  const referer = request.headers.get("referer");

  if (!referer) {
    return false;
  }

  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

/**
 * Re-issues the cookie with a fresh Max-Age. Only called where Next allows
 * cookie writes (route handlers, server actions); failures are ignored.
 */
async function refreshSessionCookie(token: string, secure: boolean) {
  try {
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
      secure,
    });
  } catch {
    // Read-only cookie store or no request scope.
  }
}
