"use server";

/**
 * Email + password authentication actions.
 *
 * SHAPE OF EVERY ACTION HERE
 *   1. Rate-limit the caller BEFORE the provider is contacted, so credential
 *      stuffing costs one Map lookup instead of one network round trip each.
 *   2. Validate server-side with the shared schema. Client-side validation is a
 *      convenience; this is the gate.
 *   3. Call a native Supabase Auth method. The password is forwarded to the
 *      provider and then dropped — it is never written to `app_users`, never
 *      logged, never returned.
 *   4. Project the verified identity into `app_users` through the SAME
 *      `syncSignedInProfile()` the OAuth callback uses, so Google users and
 *      password users are indistinguishable to every downstream check. Role
 *      assignment stays the allowlist's job and is untouched here.
 *   5. Translate any failure through `authFailureMessage()`.
 *
 * WHY SERVER ACTIONS AND NOT A CLIENT-SIDE `supabase.auth.signInWithPassword()`
 *   A server action keeps the session token out of client JavaScript entirely —
 *   the same property `/auth/callback` preserves for OAuth. It also means the
 *   profile projection happens inside the same request as the sign-in, so there
 *   is no window in which a session exists with no `app_users` row.
 */

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { getConfiguredOrigin } from "@/lib/app-origin";
import { safeNextPath } from "@/lib/auth/redirects";
import { getAuthIdentity, syncSignedInProfile } from "@/lib/auth/viewer";
import {
  parseForgotPassword,
  parseSignIn,
  parseSignUp,
  parseUpdatePassword,
  normalizeAuthEmail,
} from "@/lib/auth/credentials-schema";
import {
  authFailureMessage,
  authMessageFor,
  FORGOT_PASSWORD_NEUTRAL_MESSAGE,
} from "@/lib/auth/auth-failures";
import { hashRateKey } from "@/lib/auth/rate-key";
import type { AuthActionState } from "@/lib/auth/action-state";

/*
 * `"use server"` FILES MAY ONLY EXPORT ASYNC FUNCTIONS.
 *   `AuthActionState` and `INITIAL_AUTH_STATE` therefore live in
 *   `action-state.ts`, which the forms import as well. `AuthActionState` is a
 *   type and is erased, but the initial *value* was a runtime export and Next
 *   rejects those at build time.
 */

function fail(code: Parameters<typeof authMessageFor>[0], message?: string): AuthActionState {
  return { ok: false, message: message ?? authMessageFor(code), code };
}

/**
 * The origin to address an outgoing auth email to.
 *
 * `getConfiguredOrigin()` returns null when `NEXT_PUBLIC_APP_URL` is missing or
 * malformed, and this fails closed. The alternative — `resolveAppOrigin()`, which
 * falls back to `http://localhost:3000` so `metadataBase` keeps working — would
 * silently mail every person in production a link to a developer's laptop, which
 * reads as "signup is broken" with no cause anywhere.
 */
function requiredAuthOrigin(): string | null {
  return getConfiguredOrigin();
}

/**
 * One client's allowance, keyed on the address being tried.
 *
 * The key is a hash of the normalised email: a credential attack sweeps many
 * addresses against one endpoint, and the point of the limit is to bound how
 * often any single address can be guessed. The raw address is never used as a
 * Map key, so no plaintext email accumulates in process memory.
 *
 * A per-address limit is deliberately NOT the only defence — a distributed
 * attacker gets one attempt per address per window — but it is the correct unit
 * here, because a global limit would let one person lock everybody out.
 */
function signInAllowance(email: string): boolean {
  return checkRateLimit(`signin:${hashRateKey(email)}`);
}

/** Same idea, per action, so a reset-request flood cannot exhaust sign-ins. */
function allowanceFor(purpose: string, email: string): boolean {
  return checkRateLimit(`${purpose}:${hashRateKey(email)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign in
// ─────────────────────────────────────────────────────────────────────────────

export async function signInWithEmailAction(
  _prev: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const nextPath = safeNextPath(formData.get("next") as string | null);

  const parsed = parseSignIn({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.ok) {
    // Field-level copy is ours, not the provider's, and the password is not
    // echoed back into the state.
    return { ...fail("unknown"), message: Object.values(parsed.fieldErrors)[0] ?? "" };
  }

  const email = normalizeAuthEmail(parsed.data.email);

  if (!isSupabaseConfigured()) return fail("unconfigured");
  if (!signInAllowance(email)) return fail("rate_limited");

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });
    if (error) {
      const failure = authFailureMessage(error);
      // Logged, never shown: the provider's wording is for the server log.
      console.error("[auth] password sign-in failed:", error.message);
      return fail(failure.code, failure.message);
    }

    // Same projection the OAuth callback performs. A failure here returns null,
    // which is treated as a failed sign-in below rather than a silent success.
    const identity = await getAuthIdentity();
    if (identity) {
      await syncSignedInProfile(identity);
    }
  } catch (err) {
    console.error("[auth] password sign-in error:", err);
    return fail("unavailable");
  }

  // Outside the try: `redirect()` signals control flow by throwing, and a
  // catch-all above would swallow it into a generic error message.
  redirect(nextPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Create account
// ─────────────────────────────────────────────────────────────────────────────

export async function signUpWithEmailAction(
  _prev: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const nextPath = safeNextPath(formData.get("next") as string | null);

  const parsed = parseSignUp({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.ok) {
    return { ...fail("unknown"), message: Object.values(parsed.fieldErrors)[0] ?? "" };
  }

  const email = normalizeAuthEmail(parsed.data.email);

  if (!isSupabaseConfigured()) return fail("unconfigured");
  if (!allowanceFor("signup", email)) return fail("rate_limited");

  const origin = requiredAuthOrigin();
  if (!origin) {
    // Better a clear misconfiguration than a confirmation email addressed to
    // localhost:3000 that no real recipient can follow.
    console.error(
      "[auth] NEXT_PUBLIC_APP_URL is missing or unusable; refusing to send a confirmation email."
    );
    return fail("unconfigured");
  }

  let sessionEstablished = false;

  try {
    const supabase = await createServerSupabaseClient();

    // `data: { user, session }` rather than `{ error }`: with email
    // confirmation enabled, `signUp` succeeds with a NON-NULL user and a NULL
    // session. That is the "check your inbox" case, not a failure.
    const { data, error } = await supabase.auth.signUp({
      email,
      password: parsed.data.password,
      options: {
        data: {
          // Read back by `getAuthIdentity()` as the display name, so the very
          // first render already shows what the person typed.
          full_name: parsed.data.fullName,
        },
        // Confirmation must land on the app, not on a bare host. Server-side
        // this comes from the configured origin — never a request header.
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });

    if (error) {
      const failure = authFailureMessage(error);
      console.error("[auth] sign-up failed:", error.message);
      return fail(failure.code, failure.message);
    }

    // Confirmation disabled (or an already-confirmed address): a session came
    // back, so project the profile now exactly as the callback would.
    if (data.session) {
      const identity = await getAuthIdentity();
      if (identity) await syncSignedInProfile(identity);
      sessionEstablished = true;
    }
  } catch (err) {
    console.error("[auth] sign-up error:", err);
    return fail("unavailable");
  }

  /*
   * OUTSIDE THE TRY, DELIBERATELY.
   *   `redirect()` signals control flow by THROWING. With the call inside the
   *   try above, the catch swallowed `NEXT_REDIRECT` and turned a successful
   *   sign-up into "We could not reach our sign-in service" — the account was
   *   created and the person was told it failed. A redirect that gets caught is
   *   a redirect that does not happen, so every one of them lives out here.
   */
  if (sessionEstablished) {
    redirect(nextPath);
  }

  // Email confirmation is ON: no session exists yet, so there is nothing to
  // project and nothing to sign in. The account is created but unusable until
  // the link is clicked — which routes through /auth/callback.
  return {
    ok: true,
    code: "confirmation_required",
    message:
      "Check your inbox to confirm your email address, then sign in. The confirmation link opens this site.",
    email,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Forgot password
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request a reset email.
 *
 * ENUMERATION SAFETY: the return value is the neutral message for every
 * outcome. A registered address, an unregistered address, and a rate-limited
 * request are indistinguishable to the caller — including the `ok` flag, which
 * stays `true` in all three cases. The provider is still asked every time, so
 * a real user always gets a real email; we simply never confirm it either way.
 */
export async function requestPasswordResetAction(
  _prev: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = parseForgotPassword({ email: formData.get("email") });
  if (!parsed.ok) {
    // A malformed address is rejected before the provider is contacted, so it
    // cannot be used to probe the format space of registered accounts.
    return { ...fail("unknown"), message: Object.values(parsed.fieldErrors)[0] ?? "" };
  }

  const email = normalizeAuthEmail(parsed.data.email);

  const neutral: AuthActionState = {
    ok: true,
    code: "reset_sent",
    message: FORGOT_PASSWORD_NEUTRAL_MESSAGE,
  };

  if (!isSupabaseConfigured()) return fail("unconfigured");
  if (!allowanceFor("reset-request", email)) return neutral;

  const origin = requiredAuthOrigin();
  if (!origin) {
    // Neutral even here: a misconfigured deployment is not a fact about whether
    // this address is registered, and must not become one.
    console.error(
      "[auth] NEXT_PUBLIC_APP_URL is missing or unusable; refusing to send a reset email."
    );
    return neutral;
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      /*
       * THE RECOVERY LINK MUST GO THROUGH THE CALLBACK, NOT STRAIGHT TO THE FORM.
       *
       *   This client is created by `@supabase/ssr`, which uses the PKCE flow. The
       *   emailed link therefore carries a one-time `code`, and the code is only
       *   redeemable by `/auth/callback` calling `exchangeCodeForSession()`. A
       *   `redirectTo` of `/reset-password` delivers a code to a page that does
       *   not exchange it: no cookies are written, no recovery session exists, and
       *   `updateUser` fails with "Auth session missing" for every person who
       *   follows a perfectly valid link.
       *
       *   Routing through the callback is also what makes the link
       *   environment-aware for free — the callback resolves `next` against the
       *   request that carried the code, and the origin it came from is the one
       *   the reset was requested in.
       */
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
    });
    if (error) {
      console.error("[auth] password reset request failed:", error.message);
      // Still neutral: a provider failure must not become a signal.
      return neutral;
    }
  } catch (err) {
    console.error("[auth] password reset request error:", err);
    return neutral;
  }

  return neutral;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset password (authenticated recovery session)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set a new password using the recovery session Supabase established when the
 * emailed link was opened.
 *
 * Authorization comes from that session, not from anything in the form: there is
 * no account id, no email and no reset token accepted as input. A caller with
 * no valid recovery session cannot change any password, and `updateUser` fails
 * closed on its own as well.
 */
export async function updatePasswordAction(
  _prev: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = parseUpdatePassword({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.ok) {
    return { ...fail("unknown"), message: Object.values(parsed.fieldErrors)[0] ?? "" };
  }

  if (!isSupabaseConfigured()) return fail("unconfigured");

  try {
    const supabase = await createServerSupabaseClient();

    // Prove there is a recovery session before doing anything else, so an
    // expired or already-used link gets a specific message instead of a
    // confusing provider error.
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return fail("session_expired");
    }

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (error) {
      const failure = authFailureMessage(error);
      console.error("[auth] password update failed:", error.message);
      return fail(failure.code, failure.message);
    }

    // Changing a password is a credential change, so stamp the sign-in the same
    // way every other entry point does — `lastLoginAt` and the profile row are
    // kept consistent no matter which door the person came through.
    const identity = await getAuthIdentity();
    if (identity) await syncSignedInProfile(identity);
  } catch (err) {
    console.error("[auth] password update error:", err);
    return fail("unavailable");
  }

  // A recovery session's whole purpose was to change this password; sending the
  // person back to the sign-in form would be a pointless extra step.
  redirect("/account");
}