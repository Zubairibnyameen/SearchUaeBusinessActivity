import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { safeNextPath } from "@/lib/auth/redirects";
import { EmailSignInForm } from "@/components/auth/email-sign-in-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to search UAE business activities.",
  robots: { index: false, follow: false },
};

/**
 * Failures carried over from /auth/callback.
 *
 * Only these keys are recognised; an unrecognised `?error=` falls back to
 * generic copy, so a crafted value cannot inject text into the page. The Google
 * button used to pass the provider's own message through this map, which meant a
 * provider phrasing change would surface internal wording here.
 */
const ERROR_MESSAGES: Record<string, string> = {
  unconfigured: "Sign-in is not available on this deployment. Please contact support.",
  missing_code:
    "That sign-in link was incomplete or already used. Please try again.",
  exchange_failed:
    "We couldn’t complete the sign-in. Please try again, or use a different Google account.",
  unexpected: "Something went wrong while signing you in. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  // Validated here as well as in the callback: this value becomes a hidden form
  // field, and it is what the email sign-in action later re-validates.
  const next = safeNextPath(params.next);

  // Already authenticated — skip the extra click.
  const viewer = await getViewer();
  if (viewer) {
    redirect(next);
  }

  const configured = isSupabaseConfigured();
  const errorMessage = params.error
    ? (ERROR_MESSAGES[params.error] ??
      "We couldn’t complete the sign-in. Please try again.")
    : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-6 py-16 sm:py-24">
      <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-neutral-900">
          Sign in
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Search across every regulated activity in the UAE — free for
          registered users.
        </p>

        {errorMessage ? (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
          >
            {errorMessage}
          </p>
        ) : null}

        {configured ? (
          <div className="mt-6">
            <EmailSignInForm nextPath={next} />
          </div>
        ) : (
          <>
            <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
              Sign-in has not been configured for this deployment.
            </p>
            <p className="mt-4 text-sm text-neutral-500">
              <a
                href="/signup"
                className="font-medium text-neutral-900 underline underline-offset-2"
              >
                Create an account
              </a>{" "}
              will not be available until it is.
            </p>
          </>
        )}

        <p className="mt-5 text-xs leading-relaxed text-neutral-500">
          By continuing you agree that we may store your name, email address and
          profile picture for the purpose of operating your account. Your password
          is held by our sign-in service and is never stored in this
          application’s database. See our privacy policy for details.
        </p>
      </div>
    </div>
  );
}