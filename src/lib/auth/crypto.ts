const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(encoder.encode(value));
}

export function base64UrlDecodeString(value: string): string {
  return new TextDecoder().decode(base64UrlDecode(value));
}

/** `byteLength` cryptographically random bytes, base64url encoded. */
export function randomToken(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  let hex = "";

  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }

  return hex;
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

const MIN_AUTH_SECRET_LENGTH = 32;

/** Throws unless the HMAC secret (AUTH_SECRET) is long enough to be safe. */
export function assertAuthSecret(secret: string): string {
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(`AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters`);
  }

  return secret;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  assertAuthSecret(secret);
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function hmacSha256(secret: string, value: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(value),
  );

  return base64UrlEncode(new Uint8Array(signature));
}

/** Constant-time string comparison (length is not secret). */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }

  return diff === 0;
}

/** `<base64url(payload)>.<base64url(hmac)>` */
export async function signValue(secret: string, payload: string): Promise<string> {
  const body = base64UrlEncodeString(payload);
  return `${body}.${await hmacSha256(secret, body)}`;
}

/** Returns the payload when the signature is valid, otherwise null. */
export async function verifySignedValue(
  secret: string,
  signed: string,
): Promise<string | null> {
  const dot = signed.indexOf(".");

  if (dot <= 0 || dot === signed.length - 1) {
    return null;
  }

  const body = signed.slice(0, dot);
  const signature = signed.slice(dot + 1);
  const expected = await hmacSha256(secret, body);

  if (!timingSafeEqual(signature, expected)) {
    return null;
  }

  try {
    return base64UrlDecodeString(body);
  } catch {
    return null;
  }
}
