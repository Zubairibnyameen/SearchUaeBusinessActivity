/**
 * Rate limiting for sensitive endpoints — server-only.
 *
 * A thin, IP-keyed facade over the rate-limiter abstraction in
 * `src/lib/rate-limit`. Kept here (rather than inlined at each call site) so
 * every caller bounds attacker-controlled keys the same way.
 *
 * The default implementation is in-process and therefore SINGLE-INSTANCE /
 * DEVELOPMENT-GRADE ONLY:
 *   - state resets on server restart
 *   - it does NOT protect multi-instance / serverless deployments, because each
 *     instance keeps its own counter
 *   - it is keyed by client IP and can be bypassed behind proxies that do not
 *     forward X-Forwarded-For faithfully
 * Production hardening would swap in a shared-storage adapter (e.g. Redis /
 * Upstash) via getRateLimiter() — no caller changes.
 */
import "server-only";

import {
  getRateLimiter,
  RATE_LIMIT_PROFILES,
  type RateLimitProfileName,
} from "@/lib/rate-limit";
import type { RateLimitDecision } from "@/lib/rate-limit/types";

/** Guard against unbounded map growth from attacker-controlled keys. */
const RATE_KEY_RE = /^[a-zA-Z0-9_.:-]{1,128}$/;

function rateKey(key: string): string {
  if (!RATE_KEY_RE.test(key)) return "unknown";
  return key;
}

/** True while the caller is still within their allowance. */
export function checkRateLimit(key: string): boolean {
  return getRateLimiter().check(rateKey(key)).allowed;
}

export function clearRateLimit(key: string): void {
  getRateLimiter().clear(rateKey(key));
}

/**
 * Full decision for a caller on a named profile.
 *
 * `checkRateLimit` throws away everything except `allowed`, which is fine for a
 * boolean gate but not for an HTTP response: a 429 is supposed to tell the
 * client when to come back. This returns the limiter's own verdict unchanged,
 * including `retryAfterSeconds`, so the route can emit an accurate
 * `Retry-After` header without the limiter knowing anything about HTTP.
 */
export function checkRateLimitDecision(
  key: string,
  profile: RateLimitProfileName
): RateLimitDecision {
  return getRateLimiter(profile).check(rateKey(key));
}

/** Clear a key on a specific profile. Tests only. */
export function clearRateLimitProfile(
  key: string,
  profile: RateLimitProfileName
): void {
  getRateLimiter(profile).clear(rateKey(key));
}

export { RATE_LIMIT_PROFILES };
export type { RateLimitProfileName };
