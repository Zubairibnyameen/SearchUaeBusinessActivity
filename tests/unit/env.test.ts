import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  validateEnv,
  assertRequiredEnv,
  hasRequiredEnv,
  getEnvSummary,
  isPresent,
  redact,
  REQUIRED_ENV,
} from "@/lib/env";

describe("env validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("validates the mock environment from setup as present", () => {
    const result = validateEnv();
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.required).toEqual([...REQUIRED_ENV]);
  });

  it("flags a missing required variable as missing without leaking values", () => {
    vi.stubEnv("DATABASE_URL", "");
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("DATABASE_URL");
  });

  it("treats insecure placeholder values as missing", () => {
    vi.stubEnv("DATABASE_URL", "change-this-to-a-real-connection-string");
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("DATABASE_URL");
  });

  it("no longer requires the legacy admin password or session secret", () => {
    // Removed with the ADMIN_PASSWORD auth flow. The app must boot without them
    // so no deployment is broken by an orphaned secret that is no longer read.
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;
    const result = validateEnv();
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(REQUIRED_ENV).not.toContain("ADMIN_PASSWORD");
    expect(REQUIRED_ENV).not.toContain("ADMIN_SESSION_SECRET");
    expect(REQUIRED_ENV).toEqual(["DATABASE_URL"]);
  });

  it("hasRequiredEnv reflects presence", () => {
    expect(hasRequiredEnv()).toBe(true);
    vi.stubEnv("DATABASE_URL", "");
    expect(hasRequiredEnv()).toBe(false);
  });

  it("assertRequiredEnv throws a secret-free message naming missing variables", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => assertRequiredEnv()).toThrowError(/DATABASE_URL/);
    expect(() => assertRequiredEnv()).not.toThrowError(/postgres/);
  });

  it("assertRequiredEnv does not throw when all required are present", () => {
    expect(() => assertRequiredEnv()).not.toThrow();
  });

  it("getEnvSummary reports presence as booleans, never values", () => {
    const summary = getEnvSummary();
    expect(summary.requiredConfigured).toBe(true);
    expect(summary.configured).toHaveProperty("DATABASE_URL", true);
    const json = JSON.stringify(summary);
    expect(json).not.toContain("postgres");
  });

  it("isPresent rejects empty/whitespace/placeholder values", () => {
    expect(isPresent("X", "value")).toBe(true);
    expect(isPresent("X", undefined)).toBe(false);
    expect(isPresent("X", "   ")).toBe(false);
    expect(isPresent("X", "change-this-to-x")).toBe(false);
  });

  it("redact hides postgres connection strings", () => {
    const msg = "connection to postgresql://user:secret@db.example.com:5432/app failed";
    const out = redact(msg);
    expect(out).not.toContain("secret");
    expect(out).not.toContain("postgresql://user");
    expect(out).toContain("[REDACTED_CONNECTION_STRING]");
  });

  it("redact hides legacy admin key=value pairs even though they are no longer required", () => {
    // The names stay in SECRET_ENV_NAMES purely so a stale .env pasted into a
    // log can never leak. Their removal from the auth flow must not weaken that.
    const out = redact("ADMIN_PASSWORD=super-secret ADMIN_SESSION_SECRET=abc123");
    expect(out).not.toContain("super-secret");
    expect(out).not.toContain("abc123");
    expect(out).toContain("[REDACTED]");
  });

  it("redact leaves non-secret text intact", () => {
    const out = redact("just a normal message");
    expect(out).toBe("just a normal message");
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});
