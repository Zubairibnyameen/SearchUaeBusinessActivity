/**
 * Credential field rules for email + password authentication.
 *
 * Deliberately NOT server-only: like `profile-schema.ts`, this module holds no
 * data access and no credentials — only the single source of truth for *what a
 * valid credential looks like*. The server actions validate with it, and the
 * client forms import the same constants for `maxLength` / `minLength` and for
 * the pre-submit hints, so a rule can never drift between what the UI promises
 * and what the server accepts.
 *
 * IDENTITY BOUNDARY
 *   Passwords are NEVER stored here, in `app_users`, or anywhere in our
 *   PostgreSQL database. Supabase Auth is the only credential store: it hashes
 *   and holds them, and this application only ever forwards a password to it.
 *   Nothing in this file reads, writes, hashes or logs a password — it validates
 *   shape and length, then the value is passed straight through and dropped.
 *
 * THE PASSWORD IS NEVER ECHOED BACK
 *   No error message, no state object and no return value contains the password
 *   or any part of it. `AuthActionState` has no field that could carry one.
 */
import { z } from "zod";

/** Mirrors Supabase Auth's practical ceiling; also the input `maxLength`. */
export const AUTH_PASSWORD_MAX = 200;

/**
 * Minimum enforced by this application.
 *
 * Supabase applies its own project-level policy on top of this, so the stricter
 * of the two always wins. Ours exists so a clearly-too-weak password is refused
 * before a network round trip rather than after it.
 */
export const AUTH_PASSWORD_MIN = 8;

/**
 * Deliberately modest, not a character-class gauntlet.
 *
 * The rules that survive real-world audits are length and variety; mandating
 * symbols mostly produces `Passw0rd!` and `Password1!`, which are weaker than
 * the passphrase they replace because they follow a predictable pattern. Two
 * classes plus a length floor is the honest version.
 */
export const AUTH_PASSWORD_RULES = [
  { id: "length", test: (v: string) => v.length >= AUTH_PASSWORD_MIN, label: `at least ${AUTH_PASSWORD_MIN} characters` },
  { id: "letter", test: (v: string) => /[a-zA-Z]/.test(v), label: "at least one letter" },
  { id: "number", test: (v: string) => /[0-9]/.test(v), label: "at least one number" },
] as const;

/** Human-readable requirements list for the form hint and for error copy. */
export const AUTH_PASSWORD_REQUIREMENTS: string = AUTH_PASSWORD_RULES.map(rule =>
  rule.label
).join(", ");

/**
 * The first rule a password breaks, or null when it satisfies all of them.
 *
 * Exported for the forms so a weak password can be called out as it is typed
 * rather than after a round trip. The server still enforces independently via
 * `strongPassword()` — this is a convenience, never the gate.
 */
export function firstPasswordRuleFailure(password: string): string | null {
  for (const rule of AUTH_PASSWORD_RULES) {
    if (!rule.test(password)) return rule.label;
  }
  return null;
}

/** Mirrors the practical maximum for a real address. */
export const AUTH_EMAIL_MAX = 320;

/** Mirrors `app_users.full_name` (varchar 255). */
export const AUTH_FULL_NAME_MAX = 255;

/**
 * A trimmed, length-capped email address.
 *
 * ORDER MATTERS IN ZOD 4: `z.email().trim()` validates the format BEFORE the
 * trim is applied, so a pasted `"  layla@example.com  "` is rejected outright.
 * Trimming first and piping into the format check accepts the paste and still
 * rejects a genuinely malformed address.
 */
const authEmail = () =>
  z
    .string({ error: "Enter your email address." })
    .trim()
    .max(AUTH_EMAIL_MAX, "That email address is too long.")
    .pipe(z.email({ error: "Enter a valid email address." }));

/**
 * A password that satisfies every rule in `AUTH_PASSWORD_RULES`.
 *
 * Built from the same rule table the UI renders, so the requirement list and the
 * enforcement cannot disagree. Earlier this schema only enforced length, which
 * meant the form promised "one letter, one number" while the server accepted
 * `aaaaaaaa`.
 */
function strongPassword(message: string) {
  let schema = z.string().max(AUTH_PASSWORD_MAX, `Password must be ${AUTH_PASSWORD_MAX} characters or fewer.`);
  for (const rule of AUTH_PASSWORD_RULES) {
    // The first failing rule wins, so the message names the shortest fix.
    schema = schema.refine(rule.test, message);
  }
  return schema;
}

/**
 * Sign in.
 *
 * Deliberately does NOT check the password against `AUTH_PASSWORD_RULES`: a
 * legacy or externally-set credential that predates the current policy must
 * still be able to sign in. Applying the signup policy on the login path would
 * lock existing users out of their own accounts.
 */
export const signInSchema = z.object({
  email: authEmail(),
  password: z.string().min(1, { error: "Enter your password." }).max(AUTH_PASSWORD_MAX),
});

/**
 * Create account.
 *
 * `.strict()` so a crafted POST naming `role`, `status` or `authUserId` is
 * rejected outright rather than silently stripped — same reasoning as
 * `profileUpdateSchema`.
 */
export const signUpSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, { error: "Enter your full name." })
      .max(AUTH_FULL_NAME_MAX, `Name must be ${AUTH_FULL_NAME_MAX} characters or fewer.`),
    email: authEmail(),
    password: strongPassword(`Password must be ${AUTH_PASSWORD_REQUIREMENTS}.`),
    /**
     * Compared against `password` in `parseSignUp` rather than by Zod, because
     * a cross-field comparison needs both values and Zod v4 has no `.refine`
     * over two siblings without a `superRefine` that duplicates the messages.
     */
    confirmPassword: z.string().max(AUTH_PASSWORD_MAX),
  })
  .strict();

/** Forgot password. Shape only — never used to answer "does this exist?". */
export const forgotPasswordSchema = z.object({
  email: authEmail(),
});

/** Set a new password from an authenticated recovery session. */
export const updatePasswordSchema = z
  .object({
    password: strongPassword(`Password must be ${AUTH_PASSWORD_REQUIREMENTS}.`),
    confirmPassword: z.string().max(AUTH_PASSWORD_MAX),
  })
  .strict();

export interface SignInInput {
  email: string;
  password: string;
}

export interface SignUpInput {
  fullName: string;
  email: string;
  password: string;
}

export interface UpdatePasswordInput {
  password: string;
}

type ParseFailure = { ok: false; fieldErrors: Record<string, string> };

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) out[key] = issue.message;
  }
  return out;
}

export function parseSignIn(
  raw: Record<string, unknown>
): { ok: true; data: SignInInput } | ParseFailure {
  const parsed = signInSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
}

export function parseSignUp(
  raw: Record<string, unknown>
): { ok: true; data: SignUpInput } | ParseFailure {
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  // Mismatch is checked here, on the validated values, so the message can never
  // be skipped by a path that forgot to compare.
  if (parsed.data.password !== parsed.data.confirmPassword) {
    return {
      ok: false,
      fieldErrors: { confirmPassword: "Passwords do not match." },
    };
  }
  return { ok: true, data: parsed.data };
}

export function parseForgotPassword(
  raw: Record<string, unknown>
): { ok: true; data: { email: string } } | ParseFailure {
  const parsed = forgotPasswordSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
}

export function parseUpdatePassword(
  raw: Record<string, unknown>
): { ok: true; data: UpdatePasswordInput } | ParseFailure {
  const parsed = updatePasswordSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  if (parsed.data.password !== parsed.data.confirmPassword) {
    return {
      ok: false,
      fieldErrors: { confirmPassword: "Passwords do not match." },
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Normalise an address for the auth provider and for storage.
 *
 * Supabase treats addresses case-insensitively but the `app_users.email`
 * comparison and the admin allowlist are exact string matches, so everything is
 * folded to lowercase + trimmed at the boundary. Without this, `Layla@Example.com`
 * and `layla@example.com` would be two allowlist misses.
 */
export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Truncate a validated name for storage. Never returns null. */
export function toStoredAuthFullName(value: string): string {
  return value.trim().slice(0, AUTH_FULL_NAME_MAX);
}