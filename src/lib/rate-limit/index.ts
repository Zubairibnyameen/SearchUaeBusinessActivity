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

const _defaultLimiter = new MemoryRateLimiter();

/**
 * Resolve the active limiter for the process. Defaults to in-memory.
 * Swap this for a shared-storage adapter when production requires it.
 */
export function getRateLimiter(): RateLimiter {
  // TODO(step-8+): select a shared-storage adapter in production when Redis /
  // Upstash is provisioned. Until then the in-memory limiter is used.
  return _defaultLimiter;
}
