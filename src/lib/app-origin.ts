/**
 * The app's own public origin.
 *
 * `NEXT_PUBLIC_APP_URL` is the single source of truth for absolute URLs — it is
 * what `metadataBase` uses to turn relative Open Graph paths into absolute ones,
 * and what share links are built from.
 *
 * It is untrusted input. A missing, blank, scheme-less or malformed value used
 * to throw `TypeError: Invalid URL` while Next was collecting page data, which
 * took the entire production build down with a message that pointed at
 * `layout.tsx` rather than at the bad env var. `resolveAppOrigin()` never throws
 * and never returns something `new URL()` would reject, so a misconfiguration
 * degrades to a localhost origin instead of breaking the build.
 *
 * Kept in its own module (rather than in `env.ts`) because `env.ts` is
 * `server-only`, and `metadataBase` is also read from the client bundle path.
 */

const LOCAL_FALLBACK_ORIGIN = "http://localhost:3000";

/** True when `value` is a usable absolute http(s) origin. */
function isUsableOrigin(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  // Reject `mailto:`, `javascript:`, `data:` and other schemes that parse but
  // are meaningless as an app origin.
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * The canonical origin, without a trailing slash.
 *
 * Falls back to `http://localhost:3000` when the env var is absent or unusable,
 * which keeps `metadataBase` valid and produces correct local share links.
 */
export function resolveAppOrigin(raw?: string | null): string {
  const candidate = raw?.trim();
  if (candidate && isUsableOrigin(candidate)) {
    return new URL(candidate).origin;
  }
  return LOCAL_FALLBACK_ORIGIN;
}

/** The configured origin, or null when it is absent or unusable. */
export function getConfiguredOrigin(): string | null {
  const candidate = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (candidate && isUsableOrigin(candidate)) {
    return new URL(candidate).origin;
  }
  return null;
}
