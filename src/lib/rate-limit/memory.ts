/**
 * In-memory (single-process) rate limiter.
 *
 * SUITABLE FOR: local development and unit/integration tests.
 *
 * LIMITATIONS (must be documented for production):
 *  - State is held in an in-process Map and resets on server restart.
 *  - It does NOT protect multi-instance / serverless deployments: each
 *    instance keeps its own counter, so the effective limit scales with the
 *    number of instances.
 *  - Keyed by client-supplied identifier; can be bypassed behind proxies that
 *    do not forward X-Forwarded-For faithfully.
 *
 * For production, use the shared-storage adapter (see ./index.ts).
 */
import type { RateLimiter, RateLimitDecision } from "./types";

export interface MemoryRateLimiterOptions {
  windowMs?: number;
  maxAttempts?: number;
}

export class MemoryRateLimiter implements RateLimiter {
  readonly kind = "memory (single-instance)";
  private readonly windowMs: number;
  private readonly maxAttempts: number;
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(options: MemoryRateLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? 10 * 60 * 1000;
    this.maxAttempts = options.maxAttempts ?? 5;
  }

  check(key: string): RateLimitDecision {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt < now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return {
        allowed: true,
        remaining: this.maxAttempts - 1,
        retryAfterSeconds: null,
      };
    }
    entry.count += 1;
    if (entry.count > this.maxAttempts) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((entry.resetAt - now) / 1000)
        ),
      };
    }
    return {
      allowed: true,
      remaining: this.maxAttempts - entry.count,
      retryAfterSeconds: null,
    };
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}
