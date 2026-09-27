/**
 * Rate limiter interface — the seam that decouples callers from the concrete
 * storage implementation.
 *
 * The current production default is an in-process, single-instance limiter
 * (see ./memory.ts). For distributed / serverless deployments this MUST be
 * backed by shared storage (e.g. Redis/Upstash via the adapter in ./index.ts).
 * This interface lets us swap implementations without touching callers.
 */
export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number | null;
}

export interface RateLimiter {
  /**
   * Register an attempt for `key` and return whether it is still allowed.
   * Implementations must be safe to call concurrently.
   */
  check(key: string): RateLimitDecision;

  /** Clear the counter for `key` (used by tests and post-success reset). */
  clear(key: string): void;

  /** Human-readable description of the backing store / limitations. */
  readonly kind: string;
}
