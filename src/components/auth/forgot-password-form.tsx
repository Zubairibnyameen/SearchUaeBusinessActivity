"use client";

/**
 * Forgot-password form.
 *
 * ENUMERATION: this component renders exactly one success message, and the
 * action behind it returns that same message for every outcome. There is no code
 * path here that renders a different message for a registered address, because
 * a differing response on an unauthenticated endpoint is a free way to test
 * whether somebody has an account here.
 *
 * The form is replaced by that message on success, so the field cannot be
 * resubmitted in a loop.
 */
import { useActionState, useState } from "react";
import Link from "next/link";
import { AuthField, AuthNotice, AuthSubmit } from "@/components/auth/auth-form-parts";
import {
  requestPasswordResetAction,
} from "@/app/(public)/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/action-state";
import { AUTH_EMAIL_MAX } from "@/lib/auth/credentials-schema";

export function ForgotPasswordForm() {
const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    INITIAL_AUTH_STATE
  );
  const [email, setEmail] = useState("");

  const incomplete = email.trim().length === 0;

  if (state.ok) {
    return (
      <div className="space-y-5">
        <AuthNotice tone="success">{state.message}</AuthNotice>
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
        hint="We will send a link to set a new password."
      />

      {state.message ? <AuthNotice tone="error">{state.message}</AuthNotice> : null}

      <AuthSubmit
        pending={pending}
        disabled={incomplete}
        pendingLabel="Sending linkâ€¦"
      >
        Send reset link
      </AuthSubmit>

      <p className="text-center text-sm text-neutral-500">
        Remembered it?{" "}
        <Link
          href="/signin"
          className="font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-700"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}