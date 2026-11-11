/** Codes passed as `?auth_error=<code>`; only these map to visible messages. */
const AUTH_ERROR_MESSAGES = {
  cancelled: "Sign-in was cancelled",
  invalid_state: "Sign-in expired, please try again",
  token_exchange: "Sign-in failed while contacting Google, please try again",
  invalid_token: "Sign-in failed: Google returned an invalid or unverified account",
  banned: "This account has been suspended.",
  not_configured: "Sign-in is not configured",
  server_error: "Sign-in failed",
} as const;

export type AuthErrorCode = keyof typeof AUTH_ERROR_MESSAGES;

/** Fixed message for a known code; unknown codes are ignored (null). */
export function authErrorMessage(code: unknown): string | null {
  return typeof code === "string" && Object.hasOwn(AUTH_ERROR_MESSAGES, code)
    ? AUTH_ERROR_MESSAGES[code as AuthErrorCode]
    : null;
}
