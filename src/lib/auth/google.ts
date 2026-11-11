import { base64UrlDecodeString } from "@/lib/auth/crypto";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const CLOCK_SKEW_SECONDS = 60;

export type GoogleClaims = {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string | null;
  picture: string | null;
};

export function googleAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export class GoogleAuthError extends Error {
  /** Short code for the `?auth_error=` redirect. */
  readonly code: "token_exchange" | "invalid_token";

  constructor(message: string, code: GoogleAuthError["code"] = "invalid_token") {
    super(message);
    this.code = code;
  }
}

/** Exchanges the authorization code and returns the raw id_token. */
export async function exchangeGoogleCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      code: params.code,
      code_verifier: params.codeVerifier,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    id_token?: unknown;
    error?: unknown;
    error_description?: unknown;
  } | null;

  if (!response.ok || !payload || typeof payload.id_token !== "string") {
    const reason =
      typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new GoogleAuthError(`Token exchange failed (${reason})`, "token_exchange");
  }

  return payload.id_token;
}

/**
 * Decodes and validates the id_token claims. The token came directly from
 * Google's token endpoint over TLS, so the signature check is skipped
 * (OIDC Core 3.1.3.7, step 6).
 */
export function validateGoogleIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
): GoogleClaims {
  const parts = idToken.split(".");

  if (parts.length !== 3) {
    throw new GoogleAuthError("Malformed id_token");
  }

  let claims: Record<string, unknown>;

  try {
    claims = JSON.parse(base64UrlDecodeString(parts[1])) as Record<string, unknown>;
  } catch {
    throw new GoogleAuthError("Malformed id_token");
  }

  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) {
    throw new GoogleAuthError("Invalid token issuer");
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  if (!audiences.includes(expected.clientId)) {
    throw new GoogleAuthError("Invalid token audience");
  }

  if (Array.isArray(claims.aud) && claims.azp !== expected.clientId) {
    throw new GoogleAuthError("Invalid token audience");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS <= nowSeconds) {
    throw new GoogleAuthError("Token expired");
  }

  if (claims.nonce !== expected.nonce) {
    throw new GoogleAuthError("Invalid token nonce");
  }

  if (typeof claims.sub !== "string" || claims.sub === "") {
    throw new GoogleAuthError("Missing account id");
  }

  if (typeof claims.email !== "string" || claims.email === "") {
    throw new GoogleAuthError("Missing email");
  }

  const emailVerified =
    claims.email_verified === true || claims.email_verified === "true";

  if (!emailVerified) {
    throw new GoogleAuthError("Email not verified");
  }

  return {
    sub: claims.sub,
    email: claims.email,
    email_verified: true,
    name: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null,
    picture: typeof claims.picture === "string" && claims.picture ? claims.picture : null,
  };
}
