import { getBannedReason } from "@/lib/bans";
import { getDb, getSecret } from "@/lib/cloudflare";
import {
  clearOauthCookie,
  isSecureUrl,
  OAUTH_COOKIE,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
} from "@/lib/auth/cookies";
import { assertAuthSecret, timingSafeEqual } from "@/lib/auth/crypto";
import type { AuthErrorCode } from "@/lib/auth/errors";
import {
  exchangeGoogleCode,
  GoogleAuthError,
  validateGoogleIdToken,
} from "@/lib/auth/google";
import { openOAuthState } from "@/lib/auth/oauth-state";
import { createSession, deleteSession } from "@/lib/auth/session";
import { upsertGoogleUser } from "@/lib/auth/users";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const secure = isSecureUrl(requestUrl);
  const clearOauth = clearOauthCookie(secure);
  const cookieHeader = request.headers.get("cookie");

  const fail = (code: AuthErrorCode) =>
    redirect(`${origin}/?auth_error=${code}`, [clearOauth]);

  const providerError = requestUrl.searchParams.get("error");

  if (providerError) {
    return fail(providerError === "access_denied" ? "cancelled" : "server_error");
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");

  if (!code || !state) {
    return fail("invalid_state");
  }

  let clientId: string;
  let clientSecret: string;
  let authSecret: string;

  try {
    clientId = getSecret("GOOGLE_CLIENT_ID");
    clientSecret = getSecret("GOOGLE_CLIENT_SECRET");
    authSecret = assertAuthSecret(getSecret("AUTH_SECRET"));
  } catch (error) {
    console.error("Sign-in is not configured:", error);
    return fail("not_configured");
  }

  const oauthState = await openOAuthState(
    authSecret,
    readCookie(cookieHeader, OAUTH_COOKIE),
  );

  if (!oauthState || !timingSafeEqual(oauthState.state, state)) {
    return fail("invalid_state");
  }

  try {
    const idToken = await exchangeGoogleCode({
      code,
      codeVerifier: oauthState.verifier,
      clientId,
      clientSecret,
      redirectUri: `${origin}/auth/callback`,
    });
    const claims = validateGoogleIdToken(idToken, {
      clientId,
      nonce: oauthState.nonce,
    });

    const db = getDb();
    const user = await upsertGoogleUser(db, claims);
    const bannedReason = await getBannedReason(db, user);

    if (bannedReason !== null) {
      return fail("banned");
    }

    // Replace (rather than orphan) any session this browser already had.
    await deleteSession(db, readCookie(cookieHeader, SESSION_COOKIE));
    const token = await createSession(db, user.id);

    return redirect(`${origin}${oauthState.next}`, [
      clearOauth,
      sessionCookie(token, secure),
    ]);
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      console.warn("Sign-in rejected:", error.message);
      return fail(error.code);
    }

    console.error("Sign-in failed", error);
    return fail("server_error");
  }
}

function redirect(location: string, cookies: string[]) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });

  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(null, { status: 302, headers });
}
