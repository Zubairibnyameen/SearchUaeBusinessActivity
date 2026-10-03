import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { safeNextPath } from "@/lib/auth/redirects";
import { EmailSignUpForm } from "@/components/auth/email-sign-up-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create an account to search UAE business activities.",
  robots: { index: false, follow: false },
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  // No point offering to create an account to somebody already signed in.
  const viewer = await getViewer();
  if (viewer) {
    redirect(next);
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-6 py-16 sm:py-24">
      <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-neutral-900">
          Create account
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Set up an account to search across every regulated activity in the UAE.
        </p>

        {isSupabaseConfigured() ? (
          <div className="mt-6">
            <EmailSignUpForm nextPath={next} />
          </div>
        ) : (
          <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
            Account creation has not been configured for this deployment.
          </p>
        )}

        <p className="mt-5 text-xs leading-relaxed text-neutral-500">
          Your password is held by our sign-in service. This application stores
          only your name, email address and profile picture.
        </p>
      </div>
    </div>
  );
}