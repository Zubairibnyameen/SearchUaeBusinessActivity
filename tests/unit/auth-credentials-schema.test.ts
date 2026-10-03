import { describe, it, expect } from "vitest";
import {
  AUTH_EMAIL_MAX,
  AUTH_FULL_NAME_MAX,
  AUTH_PASSWORD_MAX,
  AUTH_PASSWORD_MIN,
  AUTH_PASSWORD_REQUIREMENTS,
  normalizeAuthEmail,
  parseForgotPassword,
  parseSignIn,
  parseSignUp,
  parseUpdatePassword,
  toStoredAuthFullName,
} from "@/lib/auth/credentials-schema";

/**
 * Credential validation shared by the four flows.
 *
 * These are the rules the UI promises and the server enforces. Two properties
 * get the most attention:
 *
 *   - the login path does NOT re-apply the signup password policy, because that
 *     would lock out anyone whose password predates the policy;
 *   - a password never appears in any returned value, because the returned state
 *     is what gets rendered.
 */

const GOOD_PASSWORD = "licence2024";

describe("sign-in validation", () => {
  it("accepts a well-formed credential pair", () => {
    const result = parseSignIn({
      email: "layla@example.com",
      password: GOOD_PASSWORD,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a missing email", () => {
    const result = parseSignIn({ email: "", password: GOOD_PASSWORD });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.email).toMatch(/valid email/i);
  });

  it("rejects a syntactically invalid email", () => {
    for (const email of [
      "not-an-email",
      "@example.com",
      "a@b",
      "a b@example.com",
    ]) {
      expect(parseSignIn({ email, password: GOOD_PASSWORD }).ok).toBe(false);
    }
  });

  it("rejects a missing password", () => {
    const result = parseSignIn({ email: "layla@example.com", password: "" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.fieldErrors.password).toMatch(/enter your password/i);
  });

  it("accepts any non-empty password, including one that fails the signup policy", () => {
    // A 4-character legacy credential must still be able to sign in. Enforcing
    // the current policy on login is how accounts get permanently locked out.
    const result = parseSignIn({ email: "layla@example.com", password: "abc" });
    expect(result.ok).toBe(true);
  });

  it("caps an absurdly long password instead of forwarding it", () => {
    const result = parseSignIn({
      email: "layla@example.com",
      password: "x".repeat(AUTH_PASSWORD_MAX + 1),
    });
    expect(result.ok).toBe(false);
  });

  it("returns the password for forwarding, but only on the success path", () => {
    // The parse layer's job is to hand a validated value to the action, so the
    // password IS present in `data`. The invariant that matters is that it
    // appears in no error message and in no state that gets rendered — those
    // are asserted in `auth-email-actions.test.ts`.
    const result = parseSignIn({
      email: "layla@example.com",
      password: GOOD_PASSWORD,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.password).toBe(GOOD_PASSWORD);
  });

  it("does not echo a rejected password back in an error", () => {
    const result = parseSignIn({ email: "bad", password: GOOD_PASSWORD });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(GOOD_PASSWORD);
  });
});

describe("sign-up validation", () => {
  const base = {
    fullName: "Layla Hassan",
    email: "layla@example.com",
    password: GOOD_PASSWORD,
    confirmPassword: GOOD_PASSWORD,
  };

  it("accepts a complete, matching, policy-compliant submission", () => {
    expect(parseSignUp(base).ok).toBe(true);
  });

  it("requires a full name", () => {
    expect(parseSignUp({ ...base, fullName: "  " }).ok).toBe(false);
  });

  it("caps the full name at the stored column width", () => {
    const result = parseSignUp({
      ...base,
      fullName: "a".repeat(AUTH_FULL_NAME_MAX + 1),
    });
    expect(result.ok).toBe(false);
  });

  it("reports a password mismatch on the confirmation field", () => {
    const result = parseSignUp({ ...base, confirmPassword: "different2024" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.confirmPassword).toMatch(/do not match/i);
    }
  });

  it("detects a mismatch even when both are individually valid", () => {
    // The point of the cross-field check: `password` passes on its own merits, so
    // only the comparison can catch this.
    const withMismatch = parseSignUp({
      ...base,
      password: "licence2024",
      confirmPassword: "licence2025",
    });
    expect(withMismatch.ok).toBe(false);
  });

  it("rejects a password below the minimum length", () => {
    expect(
      parseSignUp({ ...base, password: "a1b2", confirmPassword: "a1b2" }).ok,
    ).toBe(false);
  });

  it("rejects a password with no letter", () => {
    expect(
      parseSignUp({
        ...base,
        password: "12345678",
        confirmPassword: "12345678",
      }).ok,
    ).toBe(false);
  });

  it("rejects a password with no number", () => {
    expect(
      parseSignUp({
        ...base,
        password: "abcdefgh",
        confirmPassword: "abcdefgh",
      }).ok,
    ).toBe(false);
  });

  it("accepts a passphrase with spaces and no symbols", () => {
    // Character-class gauntles push people toward `Passw0rd!`, which is weaker.
    // A passphrase is accepted as long as it meets length and the two classes;
    // nothing here demands punctuation.
    const passphrase = "correct horse battery staple 7";
    expect(
      parseSignUp({
        ...base,
        password: passphrase,
        confirmPassword: passphrase,
      }).ok,
    ).toBe(true);
  });

  it("accepts a password exactly at the minimum length", () => {
    const min = "abcdefg1";
    expect(min).toHaveLength(AUTH_PASSWORD_MIN);
    expect(
      parseSignUp({ ...base, password: min, confirmPassword: min }).ok,
    ).toBe(true);
  });

  it("caps an over-long password", () => {
    const long = `${"a1".repeat(AUTH_PASSWORD_MAX)}`;
    expect(
      parseSignUp({ ...base, password: long, confirmPassword: long }).ok,
    ).toBe(false);
  });

  it("rejects a crafted payload carrying an authorization field", () => {
    // `.strict()` is what makes this loud. Zod strips unknown keys by default,
    // which would silently drop `role: "admin"` and still return ok.
    const result = parseSignUp({ ...base, role: "admin", status: "active" });
    expect(result.ok).toBe(false);
  });

  it("rejects a payload naming authUserId", () => {
    expect(parseSignUp({ ...base, authUserId: "forged" }).ok).toBe(false);
  });

  it("trims the name and email before returning them", () => {
    const result = parseSignUp({
      ...base,
      fullName: "  Layla Hassan  ",
      email: "  layla@example.com  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.fullName).toBe("Layla Hassan");
      expect(result.data.email).toBe("layla@example.com");
    }
  });

  it("returns the password for forwarding, but never on a failure path", () => {
    // Mirrors the sign-in case: the success value necessarily carries the
    // password so the action can forward it to the provider. No failure value
    // may, because failure values are what the form renders.
    const result = parseSignUp(base);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.password).toBe(GOOD_PASSWORD);

    const mismatched = parseSignUp({ ...base, confirmPassword: "mismatch1" });
    expect(mismatched.ok).toBe(false);
    expect(JSON.stringify(mismatched)).not.toContain(GOOD_PASSWORD);
  });

  it("does not echo a rejected password back in an error", () => {
    const result = parseSignUp({ ...base, email: "not-an-email" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(GOOD_PASSWORD);
  });

  it("describes the policy in copy the form can reuse", () => {
    expect(AUTH_PASSWORD_REQUIREMENTS).toContain(
      `${AUTH_PASSWORD_MIN} characters`,
    );
    expect(AUTH_PASSWORD_REQUIREMENTS).toContain("one letter");
    expect(AUTH_PASSWORD_REQUIREMENTS).toContain("one number");
  });
});

describe("forgot-password validation", () => {
  it("accepts a valid address", () => {
    expect(parseForgotPassword({ email: "layla@example.com" }).ok).toBe(true);
  });

  it("rejects a malformed address before any provider call", () => {
    expect(parseForgotPassword({ email: "nope" }).ok).toBe(false);
  });

  it("caps the address length", () => {
    const long = `${"a".repeat(AUTH_EMAIL_MAX)}@example.com`;
    expect(parseForgotPassword({ email: long }).ok).toBe(false);
  });

  it("carries no password field at all", () => {
    // If this schema ever grows a password, the reset flow would start asking
    // for one — a strong signal the two flows have been crossed.
    const result = parseForgotPassword({ email: "layla@example.com" });
    expect(JSON.stringify(result)).not.toContain("password");
  });
});

describe("update-password validation", () => {
  it("accepts a matching, policy-compliant pair", () => {
    expect(
      parseUpdatePassword({
        password: GOOD_PASSWORD,
        confirmPassword: GOOD_PASSWORD,
      }).ok,
    ).toBe(true);
  });

  it("reports a mismatch", () => {
    const result = parseUpdatePassword({
      password: GOOD_PASSWORD,
      confirmPassword: GOOD_PASSWORD + "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.confirmPassword).toMatch(/do not match/i);
    }
  });

  it("rejects a weak new password", () => {
    expect(
      parseUpdatePassword({ password: "abc", confirmPassword: "abc" }).ok,
    ).toBe(false);
  });

  it("accepts no identity field, so there is nothing to tamper with", () => {
    // Authorization comes from the recovery session, not from the form.
    const result = parseUpdatePassword({
      password: GOOD_PASSWORD,
      confirmPassword: GOOD_PASSWORD,
      email: "someone-else@example.com",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a payload naming a role", () => {
    const result = parseUpdatePassword({
      password: GOOD_PASSWORD,
      confirmPassword: GOOD_PASSWORD,
      role: "admin",
    });
    expect(result.ok).toBe(false);
  });
});

describe("normalisation helpers", () => {
  it("lowercases and trims an address", () => {
    expect(normalizeAuthEmail("  Layla@Example.COM ")).toBe(
      "layla@example.com",
    );
  });

  it("maps the mixed-case spelling to one allowlist entry", () => {
    // The admin allowlist compares exact strings, so a mixed-case sign-in must
    // still match `admin@example.com`.
    expect(normalizeAuthEmail("Admin@Example.com")).toBe("admin@example.com");
  });

  it("truncates and trims a stored name", () => {
    const long = `${"a".repeat(AUTH_FULL_NAME_MAX + 50)}`;
    expect(toStoredAuthFullName(long)).toHaveLength(AUTH_FULL_NAME_MAX);
    expect(toStoredAuthFullName("  Layla  ")).toBe("Layla");
  });
});
