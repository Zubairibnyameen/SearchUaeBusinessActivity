import type { NextConfig } from "next";

/**
 * Content-Security-Policy origins that must be derived from configuration
 * rather than hard-coded, so no project reference is ever baked into the repo.
 */
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();

/** `https://abc.supabase.co` -> `https://abc.supabase.co` (empty if unset). */
function supabaseOrigin(): string {
  if (!SUPABASE_URL) return "";
  try {
    const url = new URL(SUPABASE_URL);
    return url.protocol === "https:" || isLocalHost(url.hostname)
      ? url.origin
      : "";
  } catch {
    return "";
  }
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

const supabase = supabaseOrigin();
const searchApi = (process.env.SEARCH_API_URL ?? "").trim();

const connectSources = ["'self'", supabase, searchApi].filter(Boolean);

const imgSources = [
  "'self'",
  "data:",
  "blob:",
  // Google-hosted profile pictures returned by the OAuth provider.
  "https://*.googleusercontent.com",
].filter(Boolean);

const frameSources = ["'self'", supabase, "https://accounts.google.com"].filter(
  Boolean
);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      `img-src ${imgSources.join(" ")}`,
      "font-src 'self' data:",
      `connect-src ${connectSources.join(" ")}`,
      `frame-src ${frameSources.join(" ")}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers: async () => [
    { source: "/(.*)", headers: securityHeaders },
  ],
};

export default nextConfig;
