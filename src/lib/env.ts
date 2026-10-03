/**
 * Centralized server-side environment validation.
 *
 * SAFETY RULES (enforced across the codebase):
 *  - Never expose server-only env values to client bundles. Only
 *    `NEXT_PUBLIC_*` variables may be read in client code.
 *  - Never log or print secret values (DATABASE_URL, ADMIN_EMAILS). Use
 *    `redact()` / the safe helpers here.
 *  - Validation never throws at module import. This keeps `next build`
 *    (which may run without a DATABASE_URL) from failing before runtime.
 *  - `assertRequiredEnv()` is an explicit, opt-in runtime check used by the
 *    production verification script and startup boundaries so that a missing
 *    required variable makes production fail loudly and clearly, WITHOUT
 *    revealing the actual secret contents in the error.
 *
 * NOTE: `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are no longer required.
 * They belonged to the removed ADMIN_PASSWORD admin session; admin access is
 * now authorized solely by a verified Supabase session plus the `ADMIN_EMAILS`
 * allowlist. Both names are still listed in SECRET_ENV_NAMES so a leftover value
 * in an existing environment file can never be logged.
 */
import "server-only";

export interface EnvCheckResult {
  valid: boolean;
  required: string[];
  missing: string[];
  optional: string[];
  warnings: string[];
}

/** Required server-only configuration. */
export const REQUIRED_ENV = ["DATABASE_URL"] as const;

/**
 * Optional configuration.
 *
 * Google login (Supabase Auth) is opt-in: when these are absent the public
 * app still builds and every public page still works, but the
 * authentication-gated features (activity search, admin area) fail closed.
 */
export const OPTIONAL_ENV = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ADMIN_EMAILS",
] as const;

/** Public (browser-visible) members of the optional set — safe to reference in client code. */
export const PUBLIC_ENV_NAMES = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

/** Names whose values must never be printed, logged, or surfaced. */
export const SECRET_ENV_NAMES = [
  "DATABASE_URL",
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "ADMIN_EMAILS",
] as const;

/** Whether a value is considered "present and usable". */
export function isPresent(name: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Refuse obvious placeholder / insecure defaults so a misconfigured
  // production never "passes" validation with a dummy value.
  if (
    /^change-this-to/i.test(trimmed) ||
    trimmed.includes("your_password") ||
    trimmed.includes("your-secret") ||
    trimmed.includes("your_database")
  ) {
    return false;
  }
  return true;
}

/**
 * Validate the current process environment without throwing and without
 * printing secret values.
 */
export function validateEnv(): EnvCheckResult {
  const required: string[] = [];
  const missing: string[] = [];
  const optional: string[] = [];
  const warnings: string[] = [];

  for (const name of REQUIRED_ENV) {
    required.push(name);
    if (!isPresent(name, process.env[name])) {
      missing.push(name);
    }
  }

  for (const name of OPTIONAL_ENV) {
    optional.push(name);
  }

  if (isPresent("NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL)) {
    try {
      const u = new URL(process.env.NEXT_PUBLIC_APP_URL as string);
      if (u.protocol !== "https:" && u.host !== "localhost") {
        warnings.push("NEXT_PUBLIC_APP_URL should use https in production");
      }
    } catch {
      warnings.push("NEXT_PUBLIC_APP_URL is not a valid absolute URL");
    }
  }

  // ── Google login (Supabase Auth) ──────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (Boolean(supabaseUrl) !== Boolean(supabaseKey)) {
    warnings.push(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set together; Google login is disabled otherwise"
    );
  }
  if (supabaseUrl) {
    try {
      const u = new URL(supabaseUrl);
      if (u.protocol !== "https:" && u.host !== "localhost") {
        warnings.push("NEXT_PUBLIC_SUPABASE_URL should use https in production");
      }
    } catch {
      warnings.push("NEXT_PUBLIC_SUPABASE_URL is not a valid absolute URL");
    }
  }

  // ── Admin allowlist ───────────────────────────────────────────────────
  // Fail-closed: an empty ADMIN_EMAILS means the admin area is unreachable via
  // Google login. That is intentional and must be surfaced loudly.
  if (supabaseUrl && supabaseKey) {
    const admins = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (admins.length === 0) {
      warnings.push(
        "ADMIN_EMAILS is empty: no account can reach the admin area via Google login"
      );
    }
  }

  return {
    valid: missing.length === 0,
    required,
    missing,
    optional,
    warnings,
  };
}

/**
 * Explicit runtime assertion for production startup boundaries and the
 * verification script. Throws a generic, secret-free error describing WHICH
 * variables are missing — never their values.
 */
export function assertRequiredEnv(): void {
  const result = validateEnv();
  if (!result.valid) {
    throw new Error(
      `Missing required environment variable(s): ${result.missing.join(", ")}`
    );
  }
}

/** True when every required variable is configured (non-throwing). */
export function hasRequiredEnv(): boolean {
  return validateEnv().valid;
}

/**
 * A safe, minimal summary intended for the readiness endpoint and the
 * verification script. It describes presence but NEVER includes values.
 */
export function getEnvSummary(): {
  requiredConfigured: boolean;
  configured: Record<string, boolean>;
} {
  const present: Record<string, boolean> = {};
  for (const name of REQUIRED_ENV) present[name] = isPresent(name, process.env[name]);
  return {
    requiredConfigured: Object.values(present).every(Boolean),
    configured: present,
  };
}

const SECRET_MARKERS = [
  "postgres://",
  "postgresql://",
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "ADMIN_EMAILS",
];

/**
 * Redact known secret substrings from an arbitrary message before it is
 * logged or returned to a user. Conservative: if a message contains a
 * postgres-style connection string it is replaced entirely.
 */
export function redact(input: string): string {
  if (!input) return input;
  const CONN_STRING_RE = /(?:postgres|postgresql):\/\/[^\s"']+/g;
  let out = input;
  out = out.replace(CONN_STRING_RE, "[REDACTED_CONNECTION_STRING]");
  for (const marker of SECRET_MARKERS) {
    // Redact marker=value pairs up to the next separator.
    const re = new RegExp(`(${marker}\\s*=\\s*)[^\\s;,]+`, "gi");
    out = out.replace(re, "$1[REDACTED]");
  }
  return out;
}
