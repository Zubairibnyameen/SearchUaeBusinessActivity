"use client";

/**
 * Create-account form.
 *
 * The confirm-password field is validated on BOTH sides: here so the mismatch is
 * reported before a round trip, and in `parseSignUp` so the server can never be
 * made to accept a mismatched pair. The client check is a convenience, never the
 * gate.
 *
 * When the project has email confirmation enabled â€” it does â€” `signUp` succeeds
 * without a session, and the action returns `confirmation_required`. That state
 * replaces the form rather than showing a banner over it, because pressing
 * "Create account" again would only produce a second confirmation email.
 */
import { useActionState, useState } from "react";
import Link from "next/link";
import {
  AuthField,
  AuthLink,
  AuthNotice,
  AuthSubmit,
} from "@/components/auth/auth-form-parts";
import {
  signUpWithEmailAction,
} from "@/app/(public)/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/action-state";
import {
  AUTH_EMAIL_MAX,
  AUTH_FULL_NAME_MAX,
  AUTH_PASSWORD_MAX,
  AUTH_PASSWORD_REQUIREMENTS,
  firstPasswordRuleFailure,
} from "@/lib/auth/credentials-schema";

export function EmailSignUpForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(signUpWithEmailAction, INITIAL_AUTH_STATE);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(state.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  /*
   * THE CLIENT-SIDE HALF OF THE CHECKS DECLARED IN THE HEADER.
   *
   *   These are conveniences, not the gate: `parseSignUp` enforces all of it
   *   again server-side, and this file can be bypassed entirely by posting to the
   *   action directly. What they buy is that a mismatch or a missing digit is
   *   named where the person is looking, instead of arriving as a banner after a
   *   round trip.
   *
   *   Both are only evaluated once there is something to compare against, so the
   *   form does not accuse somebody of a mismatch before they have typed a
   *   confirmation.
   */
  const policyFailure =
    password.length > 0 ? firstPasswordRuleFailure(password) : null;
  const mismatch =
    confirmPassword.length > 0 && confirmPassword !== password ? true : null;

  const incomplete =
    fullName.trim().length === 0 ||
    email.trim().length === 0 ||
    password.length === 0 ||
    confirmPassword.length === 0 ||
    policyFailure !== null ||
    mismatch !== null;

  // Account created, confirmation email sent, nothing to do until it is clicked.
  if (state.code === "confirmation_required") {
    return (
      <div className="space-y-5">
        <AuthNotice tone="success">{state.message}</AuthNotice>
        <p className="text-sm leading-relaxed text-neutral-600">
          Did not get it? Check your spam folder, or ask an administrator to
          confirm the address for you.
        </p>
        <Link
          href="/signin"
          className="inline-flex w-full items-center justify-center rounded-lg border border-neutral-300 bg-white px-5 py-3 text-[15px] font-semibold text-neutral-900 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={nextPath} />

      <AuthField
        label="Full name"
        name="fullName"
        type="text"
        autoComplete="name"
        placeholder="Layla Hassan"
        required
        maxLength={AUTH_FULL_NAME_MAX}
        disabled={pending}
        value={fullName}
        onChange={event => setFullName(event.currentTarget.value)}
        hint="Shown on your account. You can change it later."
      />

      <AuthField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
        maxLength={AUTH_EMAIL_MAX}
        disabled={pending}
        value={email}
        onChange={event => setEmail(event.currentTarget.value)}
        hint="We will send a confirmation link to this address."
      />

<AuthField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        maxLength={AUTH_PASSWORD_MAX}
        disabled={pending}
        value={password}
        onChange={event => setPassword(event.currentTarget.value)}
        hint={`Must have ${AUTH_PASSWORD_REQUIREMENTS}.`}
        error={policyFailure ? `Your password still needs ${policyFailure}.` : undefined}
      />

      <AuthField
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        maxLength={AUTH_PASSWORD_MAX}
        disabled={pending}
        value={confirmPassword}
        onChange={event => setConfirmPassword(event.currentTarget.value)}
        error={mismatch ? "Passwords do not match." : undefined}
      />

      {state.message ? <AuthNotice tone="error">{state.message}</AuthNotice> : null}

      <AuthSubmit
        pending={pending}
        disabled={incomplete}
        pendingLabel="Creating accountâ€¦"
      >
        Create account
      </AuthSubmit>

      <p className="text-sm text-neutral-500">
        Already have an account?{" "}
        <AuthLink href={`/signin?next=${encodeURIComponent(nextPath)}`}>
          Sign in
        </AuthLink>
      </p>
    </form>
  );
}