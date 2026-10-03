/**
 * Redirect-target construction for client-initiated authentication — NOT
 * server-only, and safe to import from a Client Component.
 *
 * WHY THIS EXISTS
 *   The OAuth `redirectTo` has to name the origin the user is actually looking
 *   at, and that origin differs per environment (`http://localhost:3000` in dev,
 *   the Vercel domain in production). Hardcoding either one is the classic bug:
 *   a production build that redirects developers to the live site, or a local
 *   session that bounces to production and silently signs them out of dev.
 *
 * WHY `window.location.origin` AND NOT A HEADER
 *   This module is used from the browser, and `window.location.origin` is set by
 *   the browser itself from the address bar. It is not a request header, so it
 *   cannot be spoofed by a `Host:` / `X-Forwarded-Host:` line — which is exactly
 *   why no server-side code in this repo reads one for redirect purposes.
 *
 *   Server-side redirects (`/auth/callback`, `/auth/signout`, the reset-email
 *   URL) must NOT use this. They use `resolveAppOrigin()` from
 *   `@/lib/app-origin`, which reads `NEXT_PUBLIC_APP_URL` — a value an operator
 *   controls — precisely because a server has no trustworthy idea of its own
 *   public origin without trusting a header it must not trust.
 *
 * FAIL-CLOSED
 *   Every path returns `null` rather than a guessed origin when it cannot prove
 *   what the origin is. Callers treat `null` as "offer the form without an
 *   OAuth redirect", which degrades to a visible, fixable error instead of
 *   sending a session token to an attacker-chosen host.
 */

const MAX_ORIGIN_LENGTH = 300;

/**
 * True only for an absolute `http:`/`https:` origin with a host and no
 * credentials, path, query or fragment.
 *
 * The exclusions matter: `https://user:pass@evil.test` and
 * `https://good.test@evil.test` both `new URL()` happily, and either one would
 * put the provider's redirect into the wrong hands. A trailing slash is fine and
 * is normalised away.
 */
export function isTrustedBrowserOrigin(raw: string | null | undefined): boolean {
  const candidate = raw?.trim();
  if (!candidate || candidate.length > MAX_ORIGIN_LENGTH) return false;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (!parsed.hostname) return false;
  // An origin is scheme + host + port only. Anything else means the caller
  // passed a full URL and something is confused about which value this is.
  if (parsed.pathname !== "/" && parsed.pathname !== "") return false;
  if (parsed.search || parsed.hash) return false;
  return true;
}

/** The canonical origin for a trusted value, or null when untrusted. */
export function normalizeBrowserOrigin(
  raw: string | null | undefined
): string | null {
  if (!isTrustedBrowserOrigin(raw)) return null;
  return new URL((raw as string).trim()).origin;
}

/**
 * The current browser origin, or null when there is no usable window.
 *
 * Returns null during server rendering and in non-browser test environments, so
 * a caller must handle it. Every current call site is inside a click handler or
 * an effect, where the window always exists.
 */
export function currentBrowserOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return normalizeBrowserOrigin(window.location?.origin);
}

/**
 * The OAuth return target: `{origin}/auth/callback?next={nextPath}`.
 *
 * The PKCE verifier stays in the browser; only the destination is named here.
 * `nextPath` is validated by `safeNextPath` in `@/lib/auth/redirects` — this
 * function deliberately does not re-implement that, so the two cannot disagree
 * about what counts as a safe destination.
 */
export function buildOAuthCallbackUrl(
  origin: string | null,
  nextPath: string
): string | null {
  const normalized = normalizeBrowserOrigin(origin);
  if (!normalized) return null;
  return `${normalized}/auth/callback?next=${encodeURIComponent(nextPath)}`;
}

/**
 * The password-reset landing target.
 *
 * The reset email carries a one-time recovery token that Supabase appends as a
 * URL fragment to this URL. Landing on `/reset-password` (not `/signin`) is what
 * lets a recovery session be distinguished from a normal sign-in.
 */
export function buildPasswordResetUrl(origin: string | null): string | null {
  const normalized = normalizeBrowserOrigin(origin);
  if (!normalized) return null;
  return `${normalized}/reset-password`;
}