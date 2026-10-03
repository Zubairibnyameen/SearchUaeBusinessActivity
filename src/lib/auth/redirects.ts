/**
 * Redirect-target validation for authentication flows.
 *
 * Only same-origin, relative paths are accepted. This is what stops a crafted
 * `?next=` value from bouncing a freshly authenticated user to a hostile site,
 * and it is used by both the OAuth callback and the sign-in page so the two
 * can never drift apart.
 */
export const DEFAULT_AUTH_REDIRECT = "/";

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return DEFAULT_AUTH_REDIRECT;
  if (!raw.startsWith("/")) return DEFAULT_AUTH_REDIRECT;
  if (raw.startsWith("//")) return DEFAULT_AUTH_REDIRECT;
  if (raw.startsWith("/\\")) return DEFAULT_AUTH_REDIRECT;
  if (raw.includes("\n") || raw.includes("\r") || raw.includes("\t")) {
    return DEFAULT_AUTH_REDIRECT;
  }
  if (raw.length > 2048) return DEFAULT_AUTH_REDIRECT;
  return raw;
}
