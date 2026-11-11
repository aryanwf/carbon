import { signValue, verifySignedValue } from "@/lib/auth/crypto";
import { OAUTH_TTL_SECONDS } from "@/lib/auth/cookies";

export type OAuthState = {
  state: string;
  verifier: string;
  nonce: string;
  next: string;
  /** Unix ms expiry. */
  exp: number;
};

/**
 * Only same-site relative paths outside /auth (avoids redirect loops through
 * login/logout); anything else becomes "/".
 */
export function sanitizeNext(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\") ||
    /^\/auth(?:[/?#]|$)/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.length > 2048
  ) {
    return "/";
  }

  return value;
}

export async function sealOAuthState(
  secret: string,
  value: Omit<OAuthState, "exp">,
): Promise<string> {
  const payload: OAuthState = {
    ...value,
    exp: Date.now() + OAUTH_TTL_SECONDS * 1000,
  };

  return signValue(secret, JSON.stringify(payload));
}

export async function openOAuthState(
  secret: string,
  sealed: string | null,
): Promise<OAuthState | null> {
  if (!sealed) {
    return null;
  }

  const payload = await verifySignedValue(secret, sealed);

  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as Partial<OAuthState>;

    if (
      typeof parsed.state !== "string" ||
      typeof parsed.verifier !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.next !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= Date.now()
    ) {
      return null;
    }

    return {
      state: parsed.state,
      verifier: parsed.verifier,
      nonce: parsed.nonce,
      next: sanitizeNext(parsed.next),
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}
