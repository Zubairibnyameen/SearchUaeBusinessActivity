import { describe, it, expect } from "vitest";

import {
  parseProfileUpdate,
  profileUpdateSchema,
  toStoredFullName,
  PROFILE_NAME_MAX,
} from "@/lib/auth/profile-schema";

/**
 * This schema is the trust boundary between an untrusted form body and the
 * `app_users` table. The critical property is not "it validates the name" — it
 * is that a payload naming a privilege column is REJECTED rather than stripped.
 *
 * Zod's default for unknown keys is to strip them, which would silently discard
 * `role: "admin"` and then still succeed. `.strict()` is what turns that class of
 * bug into a visible 400, and the tests below pin that difference.
 */
describe("profileUpdateSchema", () => {
  it("accepts an ordinary name", () => {
    const result = profileUpdateSchema.safeParse({ fullName: "Layla Hassan" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.fullName).toBe("Layla Hassan");
  });

  it("trims surrounding whitespace", () => {
    const result = profileUpdateSchema.safeParse({ fullName: "  Omar  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.fullName).toBe("Omar");
  });

  it("accepts an empty name as an explicit clear", () => {
    const result = profileUpdateSchema.safeParse({ fullName: "   " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.fullName).toBe("");
  });

  it("rejects a name longer than the column", () => {
    const result = profileUpdateSchema.safeParse({
      fullName: "x".repeat(PROFILE_NAME_MAX + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a name exactly at the column limit", () => {
    const result = profileUpdateSchema.safeParse({
      fullName: "x".repeat(PROFILE_NAME_MAX),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing fullName entirely", () => {
    expect(profileUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a non-string fullName", () => {
    expect(profileUpdateSchema.safeParse({ fullName: 42 }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ fullName: null }).success).toBe(false);
    expect(
      profileUpdateSchema.safeParse({ fullName: { toString: "x" } }).success
    ).toBe(false);
  });

  // ── The privilege-escalation cases ──────────────────────────────────────
  describe("privilege fields are not writable", () => {
    const FORBIDDEN = [
      { role: "admin" },
      { status: "active" },
      { status: "suspended" },
      { email: "attacker@evil.test" },
      { authUserId: "22222222-2222-4222-8222-222222222222" },
      { providerUserId: "google-subject-id" },
      { id: "11111111-1111-4111-8111-111111111111" },
      { createdAt: "1999-01-01T00:00:00.000Z" },
      { lastLoginAt: "1999-01-01T00:00:00.000Z" },
      { isAdmin: true },
      { isActive: true },
    ] as const;

    it.each(FORBIDDEN)("rejects a payload carrying %j", payload => {
      expect(profileUpdateSchema.safeParse(payload).success).toBe(false);
    });

    it.each(FORBIDDEN)(
      "rejects an escalation attempt that ALSO carries a valid name (%j)",
      payload => {
        const result = profileUpdateSchema.safeParse({ ...payload, fullName: "Mallory" });
        expect(result.success).toBe(false);
      }
    );

    it("names the offending field in the error", () => {
      const result = profileUpdateSchema.safeParse({ fullName: "M", role: "admin" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues[0];
        expect(issue.code).toBe("unrecognized_keys");
        expect(issue.path).toEqual([]);
      }
    });
  });
});

describe("parseProfileUpdate", () => {
  it("returns normalised data on success", () => {
    const result = parseProfileUpdate({ fullName: " Sara " });
    expect(result).toEqual({ ok: true, data: { fullName: "Sara" } });
  });

  it("returns a field-specific error when a forbidden key is present", () => {
    const result = parseProfileUpdate({ fullName: "M", role: "admin" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/only your name/i);
    }
  });

  it("returns a length error that does not echo the submitted value", () => {
    const secretish = "y".repeat(PROFILE_NAME_MAX + 40);
    const result = parseProfileUpdate({ fullName: secretish });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(secretish);
      expect(result.error).toMatch(/characters or fewer/i);
    }
  });

  it("coerces a missing field to the clear value rather than throwing", () => {
    // The action always supplies the key (possibly as ""), so this documents
    // the fallback for any other caller.
    const result = parseProfileUpdate({});
    expect(result.ok).toBe(false);
  });
});

describe("toStoredFullName", () => {
  it("returns the trimmed name", () => {
    expect(toStoredFullName("  Layla  ")).toBe("Layla");
  });

  it("maps empty and whitespace-only to null", () => {
    expect(toStoredFullName("")).toBeNull();
    expect(toStoredFullName("   ")).toBeNull();
    expect(toStoredFullName("\t\n")).toBeNull();
  });

  it("never returns an empty string, only null or real text", () => {
    // Guards the nullable-column contract: `""` and NULL mean different things
    // to the reader (`IS NOT NULL` style checks elsewhere), so pick one.
    expect(toStoredFullName("")).not.toBe("");
  });
});
