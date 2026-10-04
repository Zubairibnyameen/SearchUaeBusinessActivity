import { describe, it, expect } from "vitest";
import {
  isGoogleProvider,
  adminProjectionNote,
  adminNameCorrectionNote,
  adminEmailOwnershipClause,
  emailSourceHint,
  accountFieldOwnershipNote,
} from "@/lib/auth/provider-copy";

/**
 * The admin panel must describe an account by the provider that actually owns
 * the identity, and must not imply Google for accounts whose provider is
 * unknown. These helpers are the single source of that wording, so they are
 * tested directly for all three provider states.
 */
describe("provider detection", () => {
  it("recognises google only for google, ignoring case and padding", () => {
    expect(isGoogleProvider("google")).toBe(true);
    expect(isGoogleProvider("  Google  ")).toBe(true);
    expect(isGoogleProvider("GOOGLE")).toBe(true);
  });

  it("treats every other provider, including missing, as non-google", () => {
    for (const p of ["email", "password", "Email/Password", "", "   ", "googleish", null, undefined]) {
      expect(isGoogleProvider(p)).toBe(false);
    }
  });
});

describe("admin provider-aware copy", () => {
  it("tells an administrator the fields came from Google", () => {
    expect(adminProjectionNote("google")).toMatch(/google/i);
    expect(adminProjectionNote("google")).toMatch(/every sign-in/i);
  });

  it("does not mention Google for an email/password account", () => {
    for (const p of ["email", "password", "", "unknown"]) {
      expect(adminProjectionNote(p)).not.toMatch(/google/i);
    }
  });

  it("tells an administrator a Google name may be corrected but not edited at source", () => {
    expect(adminNameCorrectionNote("google")).toMatch(/google/i);
  });

  it("gives a non-Google name correction note with no provider claim", () => {
    for (const p of ["email", "", "unknown"]) {
      expect(adminNameCorrectionNote(p)).not.toMatch(/google/i);
    }
  });

  it("states email ownership per provider", () => {
    expect(adminEmailOwnershipClause("google")).toMatch(/google/i);
    for (const p of ["email", "", "unknown"]) {
      expect(adminEmailOwnershipClause(p)).not.toMatch(/google/i);
      expect(adminEmailOwnershipClause(p)).toMatch(/email/i);
    }
  });

  it("keeps the Google wording consistent between admin and account views", () => {
    expect(adminProjectionNote("google")).toMatch(/google/i);
    expect(accountFieldOwnershipNote("google")).toMatch(/google/i);
    expect(emailSourceHint("google")).toMatch(/google/i);
  });

  it("never leaks Google wording into the non-Google account views", () => {
    for (const p of ["email", "password", "", "unknown", null, undefined]) {
      expect(accountFieldOwnershipNote(p)).not.toMatch(/google/i);
      expect(emailSourceHint(p)).not.toMatch(/google/i);
      expect(adminProjectionNote(p)).not.toMatch(/google/i);
    }
  });
});
