import { describe, it, expect } from "vitest";
import {
  FORGOT_PASSWORD_NEUTRAL_MESSAGE,
  authFailureMessage,
  authMessageFor,
} from "@/lib/auth/auth-failures";

/**
 * Provider-error translation.
 *
 * The property under test is that the string a person sees is ALWAYS one of our
 * own messages, never the provider's. Raw `AuthError.message` values carry
 * internals — SQL fragments, constraint names, occasionally an email address —
 * and they are for the server log only.
 */

const error = (message: string) => ({ message }) as { message: string };

describe("authFailureMessage — safe copy only", () => {
  it("maps invalid credentials to our own wording", () => {
    const failure = authFailureMessage(error("Invalid login credentials"));
    expect(failure.code).toBe("invalid_credentials");
    expect(failure.message).not.toMatch(/invalid login credentials/i);
  });

  it("never returns the provider's own text", () => {
    const raw = "Database error saving new user: duplicate key value violates unique constraint \"auth_users_email_key\"";
    const failure = authFailureMessage(error(raw));
    expect(failure.message).not.toContain(raw);
    expect(failure.message).not.toMatch(/auth_users_email_key/);
    expect(failure.message).not.toMatch(/duplicate key/i);
  });

  it("does not leak an SQL fragment it has never seen", () => {
    // An unfamiliar phrasing must fall through to generic copy, not to itself.
    const raw = "ERROR: relation \"profiles\" does not exist (SQLSTATE 42P01)";
    expect(authFailureMessage(error(raw)).message).toBe(authMessageFor("unknown"));
  });

  it("does not echo an address back from the provider message", () => {
    const raw = "User layla@example.com has no confirmed email";
    expect(authFailureMessage(error(raw)).message).not.toContain("layla@example.com");
  });

  it("classifies an unconfirmed email", () => {
    expect(authFailureMessage(error("Email not confirmed")).code).toBe("email_not_confirmed");
  });

  it("classifies an already-registered address", () => {
    expect(authFailureMessage(error("User already registered")).code).toBe("email_taken");
  });

  it("classifies a provider-side weak-password rejection", () => {
    expect(authFailureMessage(error("Password should be at least 6 characters")).code).toBe(
      "weak_password"
    );
  });

  it("classifies provider throttling", () => {
    expect(authFailureMessage(error("Too many requests")).code).toBe("rate_limited");
  });

  it("classifies an expired or missing recovery session", () => {
    expect(authFailureMessage(error("Auth session missing")).code).toBe("session_expired");
    expect(authFailureMessage(error("Session expired")).code).toBe("session_expired");
  });

  it("prefers the more specific classification when a message matches two", () => {
    // A message mentioning both must not be filed under the wrong bucket, or the
    // user is told to fix a password that is actually fine.
    const raw = "Email not confirmed: password should be reset after confirming";
    expect(authFailureMessage(error(raw)).code).toBe("email_not_confirmed");
  });

  it("files a throttled confirmation email as rate_limited, not unconfirmed", () => {
    // Supabase words a signup throttle as a confirmation email that was not sent.
    // Telling the person to check their inbox for a message that never went out
    // is the most confusing outcome this flow can produce; "wait a moment" is
    // both true and actionable.
    const raw = "Too many requests: confirmation email not sent";
    const failure = authFailureMessage(error(raw));
    expect(failure.code).toBe("rate_limited");
    expect(failure.message).not.toMatch(/inbox|confirm your email/i);
  });

  it("matches case-insensitively", () => {
    expect(authFailureMessage(error("INVALID LOGIN CREDENTIALS")).code).toBe(
      "invalid_credentials"
    );
  });

  it("falls back to the supplied code when there is no error at all", () => {
    expect(authFailureMessage(null, "unconfigured").code).toBe("unconfigured");
    expect(authFailureMessage(undefined, "unavailable").code).toBe("unavailable");
  });

  it("does not throw on a malformed or non-string message", () => {
    const odd = { message: undefined } as unknown as { message: string };
    expect(() => authFailureMessage(odd, "unavailable")).not.toThrow();
    expect(authFailureMessage(odd, "unavailable").code).toBe("unavailable");
  });

  it("falls back to generic copy for an empty message", () => {
    expect(authFailureMessage(error(""), "unavailable").code).toBe("unavailable");
  });

  it("treats 'email not found' as invalid credentials, not as an existence oracle", () => {
    // Supabase reports this instead of "no such user" for sign-in precisely so
    // the form cannot be used to enumerate accounts. The copy must not undo that.
    const failure = authFailureMessage(error("Email not found"));
    expect(failure.code).toBe("invalid_credentials");
    expect(failure.message).not.toMatch(/no account|not registered|does ?n.t exist/i);
  });
});

describe("authMessageFor", () => {
  it("returns copy for every code the flows can synthesise", () => {
    const codes = [
      "invalid_credentials",
      "email_not_confirmed",
      "email_taken",
      "weak_password",
      "rate_limited",
      "session_expired",
      "unconfigured",
      "unavailable",
      "unknown",
    ] as const;
    for (const code of codes) {
      const message = authMessageFor(code);
      expect(message.length).toBeGreaterThan(0);
      expect(message).toMatch(/\.$/);
    }
  });

  it("keeps each message distinct, so the UI can tell states apart", () => {
    const codes = [
      "invalid_credentials",
      "email_not_confirmed",
      "email_taken",
      "weak_password",
      "rate_limited",
      "session_expired",
      "unavailable",
      "unknown",
    ] as const;
    const messages = codes.map(authMessageFor);
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe("forgot-password neutrality", () => {
  it("exposes exactly one message for every outcome", () => {
    // The enumeration guard: the flow shows this string for a known address, an
    // unknown one, a provider outage and a rate-limit alike. A flow that swaps
    // in a different sentence for any of those has reintroduced the oracle.
    expect(FORGOT_PASSWORD_NEUTRAL_MESSAGE).toMatch(/if that email address has an account/i);
  });

  it("does not tell the reader whether a send actually happened", () => {
    expect(FORGOT_PASSWORD_NEUTRAL_MESSAGE).not.toMatch(/\b(sent|emailed|we sent)\b/i);
    expect(FORGOT_PASSWORD_NEUTRAL_MESSAGE).not.toMatch(/no account|unknown email/i);
  });

  it("is conditional rather than definitive", () => {
    // "If that email address has an account" is the whole trick.
    expect(FORGOT_PASSWORD_NEUTRAL_MESSAGE.toLowerCase()).toContain("if ");
  });

  it("points at spam, since a filtered reset email looks identical to a failure", () => {
    expect(FORGOT_PASSWORD_NEUTRAL_MESSAGE).toMatch(/spam/i);
  });
});