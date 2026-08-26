import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  clearRateLimit,
  verifyAdminPassword,
  createSessionToken,
  verifySessionToken,
  ADMIN_COOKIE,
} from "@/lib/auth";

describe("ADMIN_COOKIE", () => {
  it("is 'uaai_admin_session'", () => {
    expect(ADMIN_COOKIE).toBe("uaai_admin_session");
  });
});

describe("verifyAdminPassword", () => {
  it("returns true for correct password", () => {
    expect(verifyAdminPassword("test-password-123")).toBe(true);
  });

  it("returns false for wrong password", () => {
    expect(verifyAdminPassword("definitely-wrong")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(verifyAdminPassword("")).toBe(false);
  });

  it("returns false for non-string input", () => {
    expect(verifyAdminPassword(undefined as unknown as string)).toBe(false);
    expect(verifyAdminPassword(123 as unknown as string)).toBe(false);
    expect(verifyAdminPassword(null as unknown as string)).toBe(false);
  });
});

describe("createSessionToken", () => {
  it("returns an object with token and maxAge", () => {
    const result = createSessionToken();
    expect(result).toHaveProperty("token");
    expect(result).toHaveProperty("maxAge");
  });

  it("token contains a dot separator", () => {
    const { token } = createSessionToken();
    expect(token).toContain(".");
  });

  it("maxAge is 43200 (12 hours)", () => {
    const { maxAge } = createSessionToken();
    expect(maxAge).toBe(43200);
  });

  it("token is base64url-encoded body + HMAC signature", () => {
    const { token } = createSessionToken();
    const parts = token.split(".");
    expect(parts.length).toBe(2);
    // Body part should be valid base64url
    expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    // Signature part should be valid base64url
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("verifySessionToken", () => {
  it("returns true for a valid fresh token", () => {
    const { token } = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
  });

  it("returns false for a tampered token", () => {
    const { token } = createSessionToken();
    const dot = token.lastIndexOf(".");
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    // Flip a character in the signature
    const tamperedSig = sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a");
    expect(verifySessionToken(`${body}.${tamperedSig}`)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(verifySessionToken("")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(verifySessionToken(undefined)).toBe(false);
  });

  it("returns false for expired token", () => {
    // Build a token whose exp is in the past
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("node:crypto") as typeof import("node:crypto");
    const secret = process.env.ADMIN_SESSION_SECRET ?? "";
    const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const payload = JSON.stringify({ role: "admin", exp: pastExp });
    const body = Buffer.from(payload).toString("base64url");
    const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
    const expiredToken = `${body}.${sig}`;

    expect(verifySessionToken(expiredToken)).toBe(false);
  });

  it("returns false for token with wrong role", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("node:crypto") as typeof import("node:crypto");
    const secret = process.env.ADMIN_SESSION_SECRET ?? "";
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const payload = JSON.stringify({ role: "user", exp: futureExp });
    const body = Buffer.from(payload).toString("base64url");
    const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");

    expect(verifySessionToken(`${body}.${sig}`)).toBe(false);
  });

  it("returns false for random gibberish", () => {
    expect(verifySessionToken("not.a-token")).toBe(false);
    expect(verifySessionToken("abc")).toBe(false);
    expect(verifySessionToken("....")).toBe(false);
  });
});

describe("session token round-trip", () => {
  it("create → verify succeeds", () => {
    const { token } = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
  });

  it("create → tamper → verify fails", () => {
    const { token } = createSessionToken();
    const parts = token.split(".");
    const tampered = parts[0] + ".TAMPERED_SIGNATURE";
    expect(verifySessionToken(tampered)).toBe(false);
  });
});

describe("rate limiting — edge cases", () => {
  beforeEach(() => {
    clearRateLimit("edge-a");
    clearRateLimit("edge-b");
  });

  it("first call always succeeds", () => {
    expect(checkRateLimit("edge-a")).toBe(true);
  });

  it("empty string key works independently", () => {
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
});
