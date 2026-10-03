import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRateLimit, clearRateLimit } from "@/lib/auth/rate-limit";

vi.mock("server-only", () => ({}));

/**
 * Rate limiting is generic abuse protection over the shared limiter in
 * `src/lib/rate-limit`, kept in the admin auth module for reuse. These are the
 * edge cases that matter once the rate limiter is reachable from more than one
 * endpoint: unbounded key growth, and counter reuse after a clear.
 *
 * The ADMIN_PASSWORD login endpoint that originally consumed these helpers is
 * gone; the limiter itself is not admin-specific and is kept deliberately.
 */

describe("rate limiting — edge cases", () => {
  beforeEach(() => {
    clearRateLimit("edge-a");
    clearRateLimit("edge-b");
  });

  it("first call always succeeds", () => {
    expect(checkRateLimit("edge-a")).toBe(true);
  });

  it("empty string key is treated as an unknown key", () => {
    clearRateLimit("");
    expect(checkRateLimit("")).toBe(true);
    expect(checkRateLimit("")).toBe(true);
  });

  it("clearing a key that was never set is a no-op", () => {
    expect(() => clearRateLimit("never-used")).not.toThrow();
    expect(checkRateLimit("never-used")).toBe(true);
  });

  it("clearing then re-using the same key starts fresh", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("edge-b");
    expect(checkRateLimit("edge-b")).toBe(false);
    clearRateLimit("edge-b");
    expect(checkRateLimit("edge-b")).toBe(true);
    // Should allow 4 more before blocking again
    for (let i = 0; i < 4; i++) expect(checkRateLimit("edge-b")).toBe(true);
    expect(checkRateLimit("edge-b")).toBe(false);
  });

  it("collapses unbounded caller-supplied keys onto a single bucket", () => {
    // A key containing characters outside the allowed set must not create a new
    // map entry per request, which is how an in-process limiter gets its memory
    // exhausted. Every malformed key funnels to the same "unknown" bucket, so
    // clear it first to make the assertion independent of test order.
    clearRateLimit("a b");
    for (const hostile of ["a b", "x".repeat(500), "<script>", "a\nb"]) {
      expect(checkRateLimit(hostile)).toBe(true);
    }
    // Four structurally distinct hostile keys have consumed four slots of the
    // one shared bucket, so two more distinct-looking keys exhaust it.
    expect(checkRateLimit("with space")).toBe(true);
    expect(checkRateLimit("<b>bold</b>")).toBe(false);
  });

  it("gives each well-formed key its own allowance", () => {
    // The complement of the test above: a well-formed key must not be swept into
    // another caller's bucket. Hyphens, dots, colons and underscores are all
    // inside the allowed character class.
    for (const key of ["edge-a", "edge-b", "10.0.0.1", "tenant:acme", "user_1"]) {
      clearRateLimit(key);
      expect(checkRateLimit(key)).toBe(true);
      expect(checkRateLimit(key)).toBe(true);
    }
  });
});
