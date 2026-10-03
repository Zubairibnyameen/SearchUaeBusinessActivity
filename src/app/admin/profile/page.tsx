import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/viewer";
import {
  ProfileDetails,
  ProfileHeader,
  ReadOnlyNote,
} from "@/components/profile/profile-card";
import { ProfileNameForm } from "@/components/profile/profile-name-form";
import { updateAdminProfileAction } from "@/lib/auth/profile-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your admin profile",
  robots: { index: false, follow: false },
};

/**
 * The administrator's own profile.
 *
 * Deliberately NOT a user-management screen. There is no role control, no
 * status control and no self-suspension path here: promoting someone is an
 * `ADMIN_EMAILS` allowlist change, and an administrator's own status is changed
 * by another administrator in `/admin/users`. Putting either control on a page
 * describing "your own account" is the easiest way to accidentally ship a
 * self-lockout or a self-promotion.
 */
export default async function AdminProfilePage() {
  // 401 unauthenticated / 403 authenticated-but-not-admin, server-side. The
  // /admin layout already bounced non-admins; repeating the check keeps this
  // page safe if it is ever mounted outside that layout.
  const admin = await requireAdmin();

  const profile = {
    fullName: admin.fullName,
    email: admin.email,
    avatarUrl: admin.avatarUrl,
    provider: admin.provider,
    role: admin.role,
    status: admin.status,
    createdAt: admin.createdAt,
    lastLoginAt: admin.lastLoginAt,
  };

  return (
    <div className="max-w-3xl">
      <Link href="/admin" className="text-sm text-neutral-500 hover:text-neutral-700">
        &larr; Dashboard
      </Link>

      <div className="mt-4">
        <ProfileHeader
          profile={profile}
          title="Your admin profile"
          subtitle={admin.fullName?.trim() || admin.email}
        />
      </div>

      <section
        aria-labelledby="admin-profile-details"
        className="mt-8 rounded-lg border border-neutral-200 bg-white p-6"
      >
        <h2
          id="admin-profile-details"
          className="text-sm font-semibold uppercase tracking-wide text-neutral-500"
        >
          Account details
        </h2>
        <div className="mt-5">
          <ProfileDetails profile={profile} />
        </div>
        <ReadOnlyNote>
          Your administrator role comes from the <code>ADMIN_EMAILS</code>{" "}
          allowlist, not from this page — there is deliberately no control here
          to grant or revoke it, so you cannot promote or demote yourself. Your
          own account status is managed by another administrator in{" "}
          <Link href="/admin/users" className="underline underline-offset-2">
            Users
          </Link>
          ; you cannot suspend yourself.
        </ReadOnlyNote>
      </section>

      <section
        aria-labelledby="admin-profile-edit"
        className="mt-6 rounded-lg border border-neutral-200 bg-white p-6"
      >
        <h2
          id="admin-profile-edit"
          className="text-sm font-semibold uppercase tracking-wide text-neutral-500"
        >
          Edit profile
        </h2>
        <div className="mt-5">
          <ProfileNameForm
            action={updateAdminProfileAction}
            initialFullName={admin.fullName}
            submitLabel="Save changes"
            hint="This is the only field you can change here. To edit someone else's profile, open them in Users."
          />
        </div>
      </section>

      <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        <p>
          Managing other people&rsquo;s accounts lives in{" "}
          <Link
            href="/admin/users"
            className="font-medium text-neutral-900 underline underline-offset-2"
          >
            Users
          </Link>
          . There you can review any profile and suspend or reactivate an
          account — but not promote anyone, and never your own status.
        </p>
      </div>
    </div>
  );
}
