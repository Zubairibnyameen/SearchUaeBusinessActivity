"use client";

/**
 * Set-a-new-password form, reached from the emailed recovery link.
 *
 * The authorization for this page is the recovery session Supabase established
 * when the link was opened â€” the server page checks it and renders this form
 * only when it is present. The form itself carries no token and no account id,
 * so there is nothing here to tamper with: without a live recovery session the
 * action's own `getUser()` check fails closed.
 *
 * `hasRecoverySession` comes from the server page, which read the session before
 * rendering. It decides only what is SHOWN; the action re-checks independently.
 */
import { useActionState, useState } from "react";
import Link from "next/link";
import { AuthField, AuthNotice, AuthSubmit } from "@/components/auth/auth-form-parts";
import { updatePasswordAction } from "@/app/(public)/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/action-state";
import {
  AUTH_PASSWORD_MAX,
  AUTH_PASSWORD_REQUIREMENTS,
  firstPasswordRuleFailure,
} from "@/lib/auth/credentials-schema";

export function ResetPasswordForm({ hasRecoverySession }: { hasRecoverySession: boolean }) {
  const [state, formAction, pending] = useActionState(updatePasswordAction, INITIAL_AUTH_STATE);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  /*
   * CONVENIENCE ONLY — `parseUpdatePassword` enforces the same rules again on the
   * server, and the action's own `getUser()` check is the real gate. Naming the
   * missing digit next to the field beats a banner after a round trip.
   */
  const policyFailure =
    password.length > 0 ? firstPasswordRuleFailure(password) : null;
  const mismatch =
    confirmPassword.length > 0 && confirmPassword !== password ? true : null;

  const incomplete =
    password.length === 0 ||
    confirmPassword.length === 0 ||
    policyFailure !== null ||
    mismatch !== null;

  if (!hasRecoverySession) {
    return (
      <div className="space-y-5">
        <AuthNotice tone="error">
          This reset link is no longer valid. It may have expired, or it may have
          already been used. Reset links can only be opened once.
        </AuthNotice>
        <Link
          href="/forgot-password"
          className="inline-flex w-full items-center justify-center rounded-lg bg-neutral-900 px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <AuthField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        autoFocus
        maxLength={AUTH_PASSWORD_MAX}
        disabled={pending}
        value={password}
        onChange={event => setPassword(event.currentTarget.value)}
        hint={`Must have ${AUTH_PASSWORD_REQUIREMENTS}.`}
        error={policyFailure ? `Your password still needs ${policyFailure}.` : undefined}
      />

      <AuthField
        label="Confirm new password"
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
        pendingLabel="Updating passwordâ€¦"
      >
        Update password
      </AuthSubmit>
    </form>
  );
}