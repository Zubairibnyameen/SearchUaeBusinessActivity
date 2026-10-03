import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your account.",
  robots: { index: false, follow: false },
};

/**
 * The landing page for the emailed recovery link.
 *
 * ENVIRONMENT-AWARE BY CONSTRUCTION: nothing here reads the origin. The link
 * itself was addressed by the forgot-password action to
 * `${NEXT_PUBLIC_APP_URL}/reset-password`, so whichever environment the person
 * requested the reset from is the environment the link returns them to —
 * localhost stays localhost, production stays production. This page only needs
 * to handle whatever URL it was actually given.
 *
 * SESSION CHECK: Supabase establishes a recovery session when the link is
 * followed. Its presence is read server-side and decides whether the form or an
 * "expired link" message is rendered. The check is a courtesy — `updateUser`
 * re-validates independently, so a client that forges `hasRecoverySession` in
 * the payload still cannot change a password.
 */
export default async function ResetPasswordPage() {
  let hasRecoverySession = false;

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createServerSupabaseClient();
      const { data, error } = await supabase.auth.getUser();
      hasRecoverySession = !error && Boolean(data.user);
    } catch (err) {
      // A transport failure must not render as "your password is unchanged" if a
      // session in fact exists — fail to the safe, actionable message.
      console.error("[auth] recovery session check failed:", err);
      hasRecoverySession = false;
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-6 py-16 sm:py-24">
      <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-neutral-900">
          Set a new password
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          {hasRecoverySession
            ? "Choose a new password for your account. You will be signed in afterwards."
            : "Open the link from your reset email to continue."}
        </p>

        <div className="mt-6">
          <ResetPasswordForm hasRecoverySession={hasRecoverySession} />
        </div>

        <p className="mt-5 text-xs leading-relaxed text-neutral-500">
          Your password is held by our sign-in service and is never stored in this
          application’s database.
        </p>
      </div>
    </div>
  );
}