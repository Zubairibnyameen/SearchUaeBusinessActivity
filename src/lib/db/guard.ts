/**
 * Pure database-safety decision logic for CLI guards.
 *
 * Kept free of side effects so it can be unit-tested. The CLI wrapper
 * (src/scripts/db-guard.ts) applies it to process.env and exits accordingly.
 */
export type HostCategory = "local" | "remote" | "unset";

const LOCAL_HOST_RE = /^(localhost|127(\.\d{1,3}){3}|::1|0\.0\.0\.0|\[::1\])$/i;

/** Classify a DATABASE_URL host into local / remote / unset. Never prints the URL. */
export function classifyHost(databaseUrl: string | undefined): HostCategory {
  if (!databaseUrl || !databaseUrl.trim()) return "unset";
  try {
    const hostname = new URL(databaseUrl).hostname;
    if (!hostname) return "remote";
    return LOCAL_HOST_RE.test(hostname) ? "local" : "remote";
  } catch {
    return "remote";
  }
}

export interface GuardDecision {
  allowed: boolean;
  hostCategory: HostCategory;
  /** True only for non-local hosts when the caller opted in explicitly. */
  optedIn: boolean;
}

/**
 * Decide whether a dev/destructive command may proceed for the given
 * DATABASE_URL. Local hosts are allowed; remote (production-like) hosts are
 * blocked unless `allowProd` is true; an unset URL is always blocked (you
 * cannot safely run a DB command without a target).
 */
export function decideGuard(
  databaseUrl: string | undefined,
  allowProd: boolean
): GuardDecision {
  const hostCategory = classifyHost(databaseUrl);
  if (hostCategory === "unset") {
    return { allowed: false, hostCategory, optedIn: false };
  }
  if (hostCategory === "local") {
    return { allowed: true, hostCategory, optedIn: false };
  }
  // hostCategory === "remote"
  return { allowed: allowProd, hostCategory, optedIn: allowProd };
}
