import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRateLimiter } from "@/lib/rate-limit/memory";
import { getRateLimiter } from "@/lib/rate-limit";
import { classifyHost, decideGuard } from "@/lib/db/guard";

describe("MemoryRateLimiter (rate-limit abstraction)", () => {
  let limiter: MemoryRateLimiter;

  beforeEach(() => {
    limiter = new MemoryRateLimiter({ windowMs: 60_000, maxAttempts: 5 });
  });

  it("allows the first attempt with remaining = max - 1", () => {
    const d = limiter.check("ip-1");
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(4);
    expect(d.retryAfterSeconds).toBeNull();
  });

  it("blocks after max attempts", () => {
    for (let i = 0; i < 5; i++) expect(limiter.check("ip-1").allowed).toBe(true);
    const d = limiter.check("ip-1");
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
    expect(d.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 5; i++) limiter.check("ip-a");
    expect(limiter.check("ip-a").allowed).toBe(false);
    expect(limiter.check("ip-b").allowed).toBe(true);
  });

  it("clear resets the counter", () => {
    for (let i = 0; i < 5; i++) limiter.check("ip-1");
    expect(limiter.check("ip-1").allowed).toBe(false);
    limiter.clear("ip-1");
    expect(limiter.check("ip-1").allowed).toBe(true);
  });

  it("reports a memory kind", () => {
    expect(limiter.kind).toContain("memory");
  });

  it("getRateLimiter returns a usable limiter (default backends to memory)", () => {
    const instance = getRateLimiter();
    expect(instance.kind).toContain("memory");
    expect(instance.check("x").allowed).toBe(true);
  });
});

describe("db-guard decision logic", () => {
  it("blocks remote / production-like hosts by default", () => {
    const d = decideGuard("postgresql://u:p@db.neon.tech:5432/prod", false);
    expect(d.allowed).toBe(false);
    expect(d.hostCategory).toBe("remote");
    expect(d.optedIn).toBe(false);
  });

  it("allows remote hosts only with explicit opt-in", () => {
    const d = decideGuard("postgresql://u:p@db.neon.tech:5432/prod", true);
    expect(d.allowed).toBe(true);
    expect(d.optedIn).toBe(true);
  });

  it("allows localhost hosts without opt-in", () => {
    expect(decideGuard("postgresql://u:p@127.0.0.1:5432/x", false).allowed).toBe(true);
    expect(decideGuard("postgresql://u:p@localhost:5432/x", false).allowed).toBe(true);
    expect(decideGuard("postgresql://u:p@[::1]:5432/x", false).allowed).toBe(true);
  });

  it("blocks when DATABASE_URL is unset", () => {
    const d = decideGuard(undefined, false);
    expect(d.allowed).toBe(false);
    expect(d.hostCategory).toBe("unset");
  });

  it("classifyHost never leaks hostname in an unparseable case", () => {
    expect(classifyHost("not-a-url")).toBe("remote");
  });
});
