"use client";

/**
 * Email + password sign-in form.
 *
 * Submits to a server action, so the password is never read by client code for
 * any purpose other than being posted, and the session token is set in an
 * HttpOnly cookie server-side rather than in `localStorage`.
 *
 * Client-side validation here is a courtesy only. The action re-validates
 * everything with the same schema; these checks exist so a person is told about
 * an empty field without a round trip.
 */
import { useActionState, useState } from "react";
import Link from "next/link";
import {
  AuthDivider,
  AuthField,
  AuthLink,
  AuthNotice,
  AuthSubmit,
} from "@/components/auth/auth-form-parts";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import {
  signInWithEmailAction,
} from "@/app/(public)/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/action-state";
import { AUTH_EMAIL_MAX, AUTH_PASSWORD_MAX } from "@/lib/auth/credentials-schema";

export function EmailSignInForm({ nextPath }: { nextPath: string }) {
/*
   * `pending` IS `useActionState`'S OWN THIRD ELEMENT, NOT LOCAL STATE.
   *
   *   An earlier version of this file wrapped the dispatch in a `try/finally` and
   *   set a local `pending` flag around it. Under React 19 that flag never paints:
   *   the whole form submission is a transition, and the render carrying
   *   `setPending(true)` is batched into that transition and held uncommitted
   *   until the action settles — which is exactly when the flag would be reset.
   *   The observable result was that the disabled inputs and the "Signing in…"
   *   label never appeared during a slow request.
   *
   *   React tracks the pending state itself and commits it, so this is both the
   *   supported mechanism and the one that actually renders.
   */
  const [state, formAction, pending] = useActionState(
    signInWithEmailAction,
    INITIAL_AUTH_STATE
  );

  // Drives the disabled state, so an incomplete form cannot be submitted.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const incomplete = email.trim().length === 0 || password.length === 0;

  return (
    <div>
      <GoogleSignInButton nextPath={nextPath} />

      <AuthDivider>or</AuthDivider>

<form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={nextPath} />

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
        />

        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={AUTH_PASSWORD_MAX}
          disabled={pending}
          value={password}
          onChange={event => setPassword(event.currentTarget.value)}
          hint="Your password is sent straight to our sign-in service and never stored in this app's database."
        />

        {state.message ? (
          <AuthNotice tone={state.ok ? "success" : "error"}>{state.message}</AuthNotice>
        ) : null}

        <AuthSubmit
          pending={pending}
          disabled={incomplete}
          pendingLabel="Signing inâ€¦"
        >
          Sign in
        </AuthSubmit>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link
            href={`/forgot-password${nextPath !== "/" ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
            /* `inline-block py-1.5`: a standalone `text-sm` link is a 20px-tall
               target, below the WCAG 2.2 SC 2.5.8 floor. The sibling "Create
               one" link is inline in a sentence and is exempt, so it is left
               unpadded to keep the two visually level. */
            className="inline-block py-1.5 font-medium text-neutral-600 underline underline-offset-2 hover:text-neutral-900"
          >
            Forgot password?
          </Link>
          <span className="text-neutral-500">
            No account?{" "}
            <AuthLink href={`/signup?next=${encodeURIComponent(nextPath)}`}>
              Create one
            </AuthLink>
          </span>
        </div>
      </form>
    </div>
  );
}