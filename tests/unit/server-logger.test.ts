import { describe, it, expect } from "vitest";
import {
  sanitizeContext,
  toUserMessage,
  describeError,
  apiError,
} from "@/lib/server-logger";

describe("server-logger", () => {
  describe("sanitizeContext", () => {
    it("redacts sensitive keys", () => {
      const out = sanitizeContext({
        password: "hunter2",
        token: "jwt-secret",
        ip: "1.2.3.4",
      });
      expect(out?.password).toBe("[REDACTED]");
      expect(out?.token).toBe("[REDACTED]");
      expect(out?.ip).toBe("1.2.3.4");
    });

    it("redacts postgres connection strings embedded in values", () => {
      const out = sanitizeContext({
        detail: "failed postgresql://u:secret@db/ app",
      });
      expect(JSON.stringify(out)).not.toContain("secret");
      expect(JSON.stringify(out)).toContain("[REDACTED_CONNECTION_STRING]");
    });

    it("returns undefined for empty context", () => {
      expect(sanitizeContext(undefined)).toBeUndefined();
    });
  });

  describe("toUserMessage", () => {
    it("returns the fallback generic message regardless of error", () => {
      expect(toUserMessage(new Error("typed leak"))).toBe("Internal server error");
      expect(toUserMessage("some string", "Custom fallback")).toBe("Custom fallback");
    });
  });

  describe("describeError", () => {
    it("extracts and redacts error messages for logs", () => {
      const out = describeError(
        new Error("refused postgresql://u:pw@prod/db")
      );
      expect(out).not.toContain("postgresql://u:pw");
      expect(out).toContain("[REDACTED_CONNECTION_STRING]");
    });

    it("handles non-Error and empty errors", () => {
      expect(describeError(undefined)).toBe("Unknown error");
      expect(describeError(null)).toBe("Unknown error");
      expect(describeError("boom")).toBe("boom");
    });
  });

  describe("apiError", () => {
    it("returns a consistent generic 500", () => {
      const { status, body } = apiError(500);
      expect(status).toBe(500);
      expect(body).toEqual({ error: "Internal server error" });
    });

    it("returns the fallback for 500 even if a specific message is passed", () => {
      const { body } = apiError(500, "detailed leak");
      expect(body.error).toBe("Internal server error");
      expect(body.error).not.toContain("detailed");
    });

    it("maps common statuses to sensible defaults", () => {
      expect(apiError(404).body.error).toBe("Not found");
      expect(apiError(401).body.error).toBe("Unauthorized");
      expect(apiError(429).body.error).toBe("Too many requests");
    });
  });
});
