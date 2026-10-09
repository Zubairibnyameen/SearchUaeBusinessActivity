/**
 * URL / SSRF safety helpers shared by server-side fetchers and their tests.
 *
 * These live outside any `"use server"` module on purpose: server-action files
 * may only export async functions, and a locally-defined validator cannot be
 * imported by a test — which historically led the unit test to re-implement the
 * logic and drift from production (masking the IPv6 bypass below).
 */

export const OFFICIAL_HOST_PATTERNS = [
  /\.gov\.ae$/,
  /\.(gov|mil)$/,
  /^(www\.)?(dmcc|ifza|rakez|spcfz|spcfreezone|ajmanfreezones|afz)\./,
  /^(www\.)?(mohap|dha|tdra|khda|dcaa|sira|ded|municipality|centralbank|vara|scasec|uiae)\./,
];

const PRIVATE_IPV4_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/;

/**
 * Private/special-use IPv6 ranges, matched only against a colon-bearing
 * literal (see `isPrivateHost`). Ranges:
 *   ::1 / ::        loopback / unspecified
 *   fc00::/7        unique local (fc00–fdff)
 *   fe80::/10       link-local (fe80–febf)
 *   fec0::/10       deprecated site-local (fec0–feff)
 *   ff00::/8        multicast (ff00–ffff)
 *
 * `fe[89ab]` covers the full link-local /10 (fe80, fe90, fea0, feb0) — the
 * previous `fe80` literal missed fe90::/feb0:: — and `fe[c-f]` covers the
 * whole deprecated site-local block.
 */
const PRIVATE_IPV6_RE = /^(::1$|::$|f[cd]|fe[89ab]|fe[c-f]|ff)/i;

/**
 * `new URL("http://[::1]/").hostname` is `"[::1]"` — brackets included — so an
 * IPv6 literal must have them stripped before any address check, otherwise
 * every IPv6 range test silently misses (the SSRF IPv6 bypass).
 */
export function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isPrivateHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (PRIVATE_IPV4_RE.test(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // Only colon-bearing hosts are IPv6 literals. A bare domain must never be
  // mistaken for an address range (e.g. "fc-bank.example.com" is not fc00::/7).
  if (host.includes(":") && PRIVATE_IPV6_RE.test(host)) return true;
  // IPv4-mapped IPv6. `new URL` normalizes the dotted quad to hex, e.g.
  // "http://[::ffff:127.0.0.1]/" → hostname "[::ffff:7f00:1]".
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    const ipv4 = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    if (PRIVATE_IPV4_RE.test(ipv4)) return true;
  }
  return false;
}

export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    if (isPrivateHost(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function looksOfficial(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
}
