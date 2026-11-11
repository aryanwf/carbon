export const SESSION_COOKIE = "carbon_session";
export const OAUTH_COOKIE = "carbon_oauth";

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const OAUTH_TTL_SECONDS = 10 * 60;

export type CookieOptions = {
  maxAge: number;
  path: string;
  secure: boolean;
};

export function readCookie(header: string | null, name: string): string | null {
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");

    if (eq === -1 || part.slice(0, eq).trim() !== name) {
      continue;
    }

    const value = part.slice(eq + 1).trim();

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/** Cookies are Secure everywhere except plain-http localhost (dev). */
export function isSecureUrl(url: string | URL): boolean {
  const parsed = typeof url === "string" ? new URL(url) : url;
  return !(parsed.protocol === "http:" && isLocalHostname(parsed.hostname));
}

/** Same as isSecureUrl, for contexts that only know the Host header. */
export function isSecureHost(host: string | null): boolean {
  if (!host) {
    return true;
  }

  const hostname = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0];

  return !isLocalHostname(hostname.toLowerCase());
}

export function sessionCookie(token: string, secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    secure,
  });
}

export function clearSessionCookie(secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAge: 0, path: "/", secure });
}

export function oauthCookie(value: string, secure: boolean): string {
  return serializeCookie(OAUTH_COOKIE, value, {
    maxAge: OAUTH_TTL_SECONDS,
    path: "/auth",
    secure,
  });
}

export function clearOauthCookie(secure: boolean): string {
  return serializeCookie(OAUTH_COOKIE, "", { maxAge: 0, path: "/auth", secure });
}
