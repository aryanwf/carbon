import { getSecret } from "@/lib/cloudflare";
import { isSecureUrl, oauthCookie } from "@/lib/auth/cookies";
import { assertAuthSecret, randomToken, sha256Base64Url } from "@/lib/auth/crypto";
import { googleAuthorizeUrl } from "@/lib/auth/google";
import { sanitizeNext, sealOAuthState } from "@/lib/auth/oauth-state";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const next = sanitizeNext(requestUrl.searchParams.get("next"));

  let clientId: string;
  let authSecret: string;

  try {
    clientId = getSecret("GOOGLE_CLIENT_ID");
    authSecret = assertAuthSecret(getSecret("AUTH_SECRET"));
  } catch (error) {
    console.error("Sign-in is not configured:", error);
    return redirect(`${origin}/?auth_error=not_configured`);
  }

  const state = randomToken(32);
  const verifier = randomToken(32);
  const nonce = randomToken(32);
  const sealed = await sealOAuthState(authSecret, { state, verifier, nonce, next });

  const location = googleAuthorizeUrl({
    clientId,
    redirectUri: `${origin}/auth/callback`,
    state,
    codeChallenge: await sha256Base64Url(verifier),
    nonce,
  });

  return redirect(location, oauthCookie(sealed, isSecureUrl(requestUrl)));
}

function redirect(location: string, setCookie?: string) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });

  if (setCookie) {
    headers.append("Set-Cookie", setCookie);
  }

  return new Response(null, { status: 302, headers });
}
