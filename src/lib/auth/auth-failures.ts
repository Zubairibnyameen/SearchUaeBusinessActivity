/**
 * Translation of authentication provider failures into user-facing copy.
 *
 * ONE RULE, ENFORCED HERE: a raw provider error never reaches a person.
 *
 * `supabase.auth.*` returns errors carrying the provider's internal wording,
 * sometimes including table names, constraint names or SQL fragments. Those are
 * for the server log, not for a login form. Every action funnels its failure
 * through `authFailureMessage()` so the mapping lives in exactly one place and
 * cannot drift between the four flows.
 *
 * THE EMAIL-EXISTENCE RULE
 *   Forgot password returns the SAME message whether or not the address is
 *   registered. That is not politeness — a differing response is a free account
 *   enumeration oracle, and this one is reachable without any credential. The
 *   enumeration-safe copy is applied to *every* outcome of that flow, including
 *   success, so it cannot be distinguished by response time or wording.
 */
import "server-only";

import type { AuthError } from "@supabase/supabase-js";

/** Stable, non-identifying codes a UI can branch on without parsing prose. */
export type AuthFailureCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "email_taken"
  | "weak_password"
  | "rate_limited"
  | "session_expired"
  | "unconfigured"
  | "unavailable"
  | "unknown";

/** Copy shown to a person. Deliberately says nothing about which field was wrong. */
const MESSAGES: Record<AuthFailureCode, string> = {
  invalid_credentials: "That email address and password combination is not correct.",
  email_not_confirmed: "Confirm your email address first — check your inbox for the confirmation link we sent you.",
  email_taken: "We could not create an account with those details. If you already have one, sign in instead.",
  weak_password: "That password does not meet our requirements yet.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  session_expired: "This link has expired or has already been used. Request a new one to continue.",
  unconfigured:
    "Sign-in is not available on this deployment. Please contact support.",
  unavailable:
    "We could not reach our sign-in service. Please try again in a moment.",
  unknown: "We could not complete that. Please try again.",
};

/**
 * Provider messages that mean something specific to a person.
 *
 * Matched case-insensitively as a substring. This is a *classification* step,
 * not a display step: the value returned is always our own copy, never the
 * matched string, so an unfamiliar provider phrasing cannot leak through by
 * falling past this list.
 */
function classify(message: string): AuthFailureCode {
  const m = message.toLowerCase();

  /*
   * ORDER MATTERS, AND THROTTLING IS CHECKED FIRST.
   *
   * When a signup is throttled, Supabase's wording is typically about the
   * confirmation *email* not having gone out — a message that mentions both
   * rate limiting and confirmation. Filing that under `email_not_confirmed`
   * would send the person to their inbox for a message that was never sent,
   * which is the single most confusing outcome this flow can produce. "Wait a
   * moment" is both true and actionable; "check your inbox" is neither.
   */
  if (m.includes("rate limit") || m.includes("too many") || m.includes("over_request_rate")) {
    return "rate_limited";
  }

  if (
    m.includes("email not confirmed") ||
    m.includes("email_not_confirmed") ||
    m.includes("confirm your email")
  ) {
    return "email_not_confirmed";
  }
  if (
    m.includes("invalid login credentials") ||
    m.includes("invalid credentials") ||
    m.includes("wrong email") ||
    m.includes("wrong password") ||
    m.includes("email not found")
  ) {
    return "invalid_credentials";
  }
  if (
    m.includes("user already registered") ||
    m.includes("already been registered") ||
    m.includes("already exists")
  ) {
    return "email_taken";
  }
  if (m.includes("password should be") || m.includes("weak") || m.includes("too short")) {
    return "weak_password";
  }
  if (
    m.includes("session") &&
    (m.includes("not found") || m.includes("missing") || m.includes("expired") || m.includes("invalid"))
  ) {
    return "session_expired";
  }
  return "unknown";
}

export interface AuthFailure {
  code: AuthFailureCode;
  message: string;
}

/**
 * Map a provider error to safe copy.
 *
 * The original error is returned alongside so the caller can log it verbatim
 * server-side while displaying only `message`.
 */
export function authFailureMessage(
  error: Pick<AuthError, "message"> | null | undefined,
  fallback: AuthFailureCode = "unknown"
): AuthFailure {
  const raw = typeof error?.message === "string" ? error.message : "";
  const code = raw ? classify(raw) : fallback;
  return { code, message: MESSAGES[code] ?? MESSAGES.unknown };
}

/** Copy for a known code, for flows that synthesise a failure themselves. */
export function authMessageFor(code: AuthFailureCode): string {
  return MESSAGES[code] ?? MESSAGES.unknown;
}

/**
 * The single forgot-password response, shown for every outcome.
 *
 * Exported so the flow and its tests cannot disagree about the wording.
 */
export const FORGOT_PASSWORD_NEUTRAL_MESSAGE =
  "If that email address has an account, a password reset link is on its way. Please check your inbox and your spam folder.";