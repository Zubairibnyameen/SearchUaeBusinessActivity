/**
 * Server-side admin allowlist — server-only module.
 *
 * The admin area is gated by an EXPLICIT allowlist of provider account
 * e-mail addresses, read from the server-only `ADMIN_EMAILS` environment
 * variable. It is never sent to the client, never hardcoded into frontend
 * code, and cannot be influenced by query parameters, cookies or request
 * bodies.
 *
 * Design notes:
 *   * FAIL-CLOSED. An empty/absent/malformed `ADMIN_EMAILS` grants nothing.
 *   * Comparison is case-insensitive and whitespace-tolerant.
 *   * This is an *additional* condition, never a bypass: a caller must have a
 *     valid, verified provider session before the allowlist is consulted.
 *     Knowing the admin URL is therefore never sufficient.
 */
import "server-only";

/** Intentionally conservative: enough for real Google accounts, not a catch-all. */
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export const ADMIN_EMAILS_ENV = "ADMIN_EMAILS";

/** Parsed, normalized allowlist. Empty when unset → nobody is an admin. */
export function getAdminEmailAllowlist(): string[] {
  const raw = process.env[ADMIN_EMAILS_ENV];
  if (!raw || typeof raw !== "string") return [];

  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (email.length > 0 && email.length <= 320 && EMAIL_RE.test(email)) {
      seen.add(email);
    }
  }
  return [...seen];
}

/** True only for an address explicitly listed in ADMIN_EMAILS. */
export function isAllowlistedAdminEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return false;
  return getAdminEmailAllowlist().includes(normalized);
}
