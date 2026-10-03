/**
 * Rate limiter factory.
 *
 * CURRENT BEHAVIOR: always returns the in-memory (single-instance) limiter.
 * This is safe for local development and tests, but is NOT sufficient for a
 * distributed or serverless production deployment.
 *
 * PRODUCTION LIMITATION (explicit, documented):
 * The app currently relies on an in-process limiter. In a multi-instance or
 * serverless runtime (e.g. Vercel) each instance keeps its own counter, so
 * the effective per-key limit is multiplied by the number of instances and
 * state resets on cold starts. This is an ACCEPTED, DOCUMENTED limitation
 * for this step.
 *
 * UPGRADE PATH: to add a shared-storage implementation (Redis / Upstash),
 * implement the `RateLimiter` interface from ./types and return it from this
 * factory, e.g.:
 *
 *   if (process.env.RATE_LIMITER === "redis") {
 *     return new RedisRateLimiter({ url: process.env.REDIS_URL });
 *   }
 *
 * No caller needs to change because every caller depends on the interface.
 */
import type { RateLimiter } from "./types";
import { MemoryRateLimiter } from "./memory";

/**
 * Named allowance profiles.
 *
 * One profile is NOT enough to serve every endpoint. The original limiter was
 * built for credential endpoints: a handful of attempts against a login form is
 * already abusive, so the default is deliberately tiny. Applying that same
 * budget to a search endpoint would break normal use — a person comparing
 * jurisdictions pages through results and hits the ceiling in seconds.
 *
 * A profile is only a pair of numbers. It is NOT a second rate-limiting system:
 * every profile is served by the same `RateLimiter` interface and the same
 * implementations, so swapping in Redis upgrades all of them together and no
 * call site changes.
 */
export interface RateLimitProfile {
  windowMs: number;
  maxAttempts: number;
}

export const RATE_LIMIT_PROFILES = {
  /**
   * Credential / one-shot endpoints. Unchanged from the original default, so
   * existing callers keep exactly the behaviour their tests pin.
   */
  sensitive: { windowMs: 10 * 60 * 1000, maxAttempts: 5 },
  /**
   * Search. Sized for an interactive session, not for a script: a person
   * refining filters and paging through results stays far below this, while a
   * runaway loop or a scraper hits it within seconds. Chosen to bound
   * accidental and excessive automated use without throttling normal SaaS
   * traffic.
   */
  search: { windowMs: 60 * 1000, maxAttempts: 120 },
} as const satisfies Record<string, RateLimitProfile>;

export type RateLimitProfileName = keyof typeof RATE_LIMIT_PROFILES;

/** One limiter instance per profile, created once and reused. */
const _limiters: Record<RateLimitProfileName, RateLimiter> = {
  sensitive: new MemoryRateLimiter(RATE_LIMIT_PROFILES.sensitive),
  search: new MemoryRateLimiter(RATE_LIMIT_PROFILES.search),
};

/**
 * Resolve the active limiter for the process. Defaults to in-memory.
 * Swap this for a shared-storage adapter when production requires it.
 *
 * @param profile Which allowance to apply. Omit for the `sensitive` default.
 */
export function getRateLimiter(profile?: RateLimitProfileName): RateLimiter {
  // TODO(step-8+): select a shared-storage adapter in production when Redis /
  // Upstash is provisioned. Until then the in-memory limiter is used.
  return profile ? _limiters[profile] : _limiters.sensitive;
}
