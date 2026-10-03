import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Request a password reset link.",
  // Deliberately excluded from search: this page is a dead end for anyone
  // arriving without a reset link, and indexing it invites crawling it.
  robots: { index: false, follow: false },
};

/**
 * Public by necessity — the person using it cannot sign in.
 *
 * The page is deliberately non-committal: it says it will send a link if the
 * address has an account, and never confirms whether it does. `?next` is not
 * read here at all; the reset email's destination is built server-side from the
 * configured origin, so nothing in this request can influence where the
 * recovery link lands.
 */
export default async function ForgotPasswordPage() {
  // Already signed in? There is nothing to recover to; send them to the account
  // page instead of pretending a reset is needed.
  const viewer = await getViewer();
  if (viewer) {
    redirect("/account");
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-6 py-16 sm:py-24">
      <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-neutral-900">
          Forgot password
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Enter the email address on your account and we will send you a link to
          set a new password.
        </p>

        {isSupabaseConfigured() ? (
          <div className="mt-6">
            <ForgotPasswordForm />
          </div>
        ) : (
          <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
            Password reset has not been configured for this deployment.
          </p>
        )}
      </div>
    </div>
  );
}