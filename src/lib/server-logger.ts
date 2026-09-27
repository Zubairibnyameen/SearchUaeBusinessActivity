/**
 * Centralized server-side logging & error utility.
 *
 * Design goals:
 *  - User-facing errors are always generic (no internals, no stack traces,
 *    no secrets).
 *  - Server logs retain useful diagnostic context.
 *  - Secrets are redacted: DATABASE_URL, ADMIN_PASSWORD, ADMIN_SESSION_SECRET
 *    and any postgres-style connection string are never logged.
 *  - Raw sensitive request payloads (passwords, cookies, tokens) are never
 *    logged.
 *  - Provider-agnostic so Sentry (or another provider) can be wired in later
 *    via a single adapter point (`reportError`).
 */
import "server-only";
import { redact } from "@/lib/env";

/** Names of headers/fields that must never be logged even in debug output. */
const SENSITIVE_FIELDS = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "token",
  "session",
  "secret",
];

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_FIELDS.some((f) => lower.includes(f));
}

/** Filter a plain object/dict so sensitive keys are not emitted. */
export function sanitizeContext(
  context?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (isSensitive(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = typeof v === "string" ? redact(v) : v;
  }
  return out;
}

/** Return a safe, generic message for a user-facing error response. */
export function toUserMessage(err: unknown, fallback = "Internal server error"): string {
  void err;
  return fallback;
}

/** Extract a diagnostic message from an unknown error, redacted for logs. */
export function describeError(err: unknown): string {
  if (!err) return "Unknown error";
  const msg = err instanceof Error ? err.message : String(err);
  return redact(msg);
}

/**
 * Log a server-side error with redacted context.
 * Returns nothing; never throws.
 */
export function logServerError(
  source: string,
  err: unknown,
  context?: Record<string, unknown>
): void {
  console.error(
    `[${source}] ${describeError(err)}`,
    context ? JSON.stringify(sanitizeContext(context)) : ""
  );
}

/**
 * Adapter point for a future error-monitoring provider (e.g. Sentry).
 * Called from logServerError-companion flows; kept as a no-op stub so no
 * paid provider or network call is performed in this step.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function reportError(_err: unknown, _context?: Record<string, unknown>): void {
  // Reserved: wire in an APM/error-monitoring provider here later.
}

/**
 * Build a generic JSON API error response body + status.
 * Keeps API error responses consistent and leak-free.
 */
export function apiError(status: number, fallbackMessage = "Internal server error") {
  const message =
    status === 400
      ? fallbackMessage
      : status === 401
        ? "Unauthorized"
        : status === 404
          ? "Not found"
          : status === 429
            ? "Too many requests"
            : fallbackMessage;

  const json_body = { error: message };
  if (status >= 500) {
    // For 5xx, always generic.
    json_body.error = "Internal server error";
  }
  return {
    status,
    body: json_body,
  };
}
