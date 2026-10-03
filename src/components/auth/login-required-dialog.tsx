"use client";

import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthDivider } from "@/components/auth/auth-form-parts";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { safeNextPath } from "@/lib/auth/redirects";

/** Plain envelope mark, mirroring `GoogleMark` so both options read as peers. */
function EmailMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
      />
    </svg>
  );
}

/**
 * Sign-in wall shown when someone tries to run a gated search without an
 * account.
 *
 * The attempted query is carried through the round trip in the `next`
 * parameter, so signing in resumes the exact search the user was trying to run.
 *
 * Both authentication methods the product actually supports are offered here —
 * Google and email/password — matching `/signin`. The email option is a plain
 * link into that existing page rather than a second copy of the sign-in form:
 * there is deliberately no duplicated `signInWithEmail` call, no third Google
 * button, and no divergent validation.
 *
 * `nextPath` is run through `safeNextPath()` here even though both current
 * callers build the value themselves. This component is the one place a
 * crafted path could be handed to an auth provider, so it fails closed at the
 * boundary rather than trusting every future caller.
 */
export function LoginRequiredDialog({
  open,
  onOpenChange,
  nextPath,
  title = "Sign in to search activities",
  description = "Sign in to search UAE business activities.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nextPath: string;
  title?: string;
  description?: string;
}) {
  const next = safeNextPath(nextPath);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <GoogleSignInButton nextPath={next} autoFocus />

        <AuthDivider>or</AuthDivider>

        <Link
          href={`/signin?next=${encodeURIComponent(next)}`}
          onClick={() => onOpenChange(false)}
          className="inline-flex w-full items-center justify-center gap-2.5 rounded-lg border border-neutral-300 bg-white px-5 py-3 text-[15px] font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25"
        >
          <EmailMark className="h-4 w-4" />
          Continue with Email
        </Link>

        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          Signing in with Google uses your account only to confirm who you are.
          We never post to your Drive, read your email, or share anything
          externally.
        </p>
      </DialogContent>
    </Dialog>
  );
}
