import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { profileReadOnlyNote } from "@/lib/auth/provider-copy";
import { AccountSuspendedNotice } from "@/components/auth/account-suspended-notice";
import {
  ProfileDetails,
  ProfileHeader,
  ReadOnlyNote,
} from "@/components/profile/profile-card";
import { ProfileNameForm } from "@/components/profile/profile-name-form";
import { updateOwnProfileAction } from "@/lib/auth/profile-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your profile",
  description: "Review and update your UAE Activity Intelligence profile.",
  robots: { index: false, follow: false },
};

export default async function AccountProfilePage() {
  const viewer = await getViewer();

  // No verified session: this page shows personal data, so there is nothing to
  // render anonymously. Send them to sign in and bring them straight back.
  if (!viewer) {
    redirect(`/signin?next=${encodeURIComponent("/account/profile")}`);
  }

  const profile = {
    fullName: viewer.fullName,
    email: viewer.email,
    avatarUrl: viewer.avatarUrl,
    provider: viewer.provider,
    role: viewer.role,
    status: viewer.status,
    createdAt: viewer.createdAt,
    lastLoginAt: viewer.lastLoginAt,
  };

  return (
    <div className="bg-neutral-50">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/account"
          /* `py-1.5`: a bare `text-sm` link is a 20px-tall target, below the
             WCAG 2.2 SC 2.5.8 floor. This is the only way back from the page. */
          className="inline-flex items-center gap-1.5 py-1.5 text-sm text-neutral-500 hover:text-neutral-700"
        >
          &larr; Your account
        </Link>

        <div className="mt-4">
          <ProfileHeader
            profile={profile}
            title="Your profile"
            subtitle={viewer.fullName?.trim() || viewer.email}
          />
        </div>

        {!viewer.isActive ? (
          <div className="mt-6">
            <AccountSuspendedNotice />
          </div>
        ) : null}

        {!isSupabaseConfigured() ? (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            Sign-in is not configured on this deployment, so your profile cannot
            be loaded.
          </p>
        ) : null}

        {/* ── Read-only facts ─────────────────────────────────────────── */}
        <section
          aria-labelledby="profile-details-heading"
          className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8"
        >
          <h2
            id="profile-details-heading"
            className="text-sm font-semibold uppercase tracking-wide text-neutral-500"
          >
            Account details
          </h2>
          <div className="mt-5">
            <ProfileDetails profile={profile} />
          </div>
          <ReadOnlyNote>
            {profileReadOnlyNote(profile.provider)} Your role and account status
            are assigned by an administrator. No authentication tokens, OAuth
            secrets or session credentials are ever shown on this page or sent to
            your browser.
          </ReadOnlyNote>
        </section>

        {/* ── Editable ────────────────────────────────────────────────── */}
        <section
          aria-labelledby="profile-edit-heading"
          className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8"
        >
          <h2
            id="profile-edit-heading"
            className="text-sm font-semibold uppercase tracking-wide text-neutral-500"
          >
            Edit profile
          </h2>
          <div className="mt-5">
            <ProfileNameForm
              action={updateOwnProfileAction}
              initialFullName={viewer.fullName}
              canSubmit={viewer.isActive && isSupabaseConfigured()}
              lockedReason={
                !isSupabaseConfigured()
                  ? "Sign-in is not configured on this deployment."
                  : "This account is suspended, so its profile is read-only."
              }
              hint="This is the only field you can change. Leave it blank to remove your name. Your role, status and email are managed for you."
            />
          </div>
        </section>
      </div>
    </div>
  );
}
