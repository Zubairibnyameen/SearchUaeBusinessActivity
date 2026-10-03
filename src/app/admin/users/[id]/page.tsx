import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/viewer";
import { getAdminUserById, parseUserId } from "@/lib/auth/admin-users";
import {
  ProfileDetails,
  ProfileHeader,
  ReadOnlyNote,
  formatProfileDateTime,
} from "@/components/profile/profile-card";
import { UserStatusForm } from "@/components/admin/user-status-form";
import { UserProfileNameForm } from "@/components/admin/user-profile-name-form";
import {
  adminNameCorrectionNote,
  adminProjectionNote,
} from "@/lib/auth/provider-copy";
import { updateUserProfileNameAction } from "@/lib/auth/profile-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "User profile",
  robots: { index: false, follow: false },
};

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  /*
   * The gate runs BEFORE the route parameter is read, so an unauthorized caller
   * never reaches the id validation below and cannot use the 404-vs-403
   * distinction to learn whether a given id exists.
   */
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    redirect(`/signin?next=${encodeURIComponent("/admin/users")}`);
  }

  const { id } = await params;
  // A malformed id can never be a real row, so 404 rather than 500.
  if (!parseUserId(id)) notFound();

  const user = await getAdminUserById(id);
  // A well-formed id with no row is indistinguishable from a bad one on
  // purpose: the page must not become an oracle for which ids exist.
  if (!user) notFound();

  const isSelf = user.id === admin.id;

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/users"
        className="text-sm text-neutral-500 hover:text-neutral-700"
      >
        &larr; All users
      </Link>

      <div className="mt-4">
        <ProfileHeader
          profile={{
            fullName: user.fullName,
            email: user.email,
            avatarUrl: user.avatarUrl,
            provider: user.provider,
            role: user.role,
            status: user.status,
            createdAt: user.createdAt,
            lastLoginAt: user.lastLoginAt,
          }}
          subtitle={user.email}
          title={user.fullName?.trim() || "Unnamed account"}
        />
      </div>

      {isSelf ? (
        <p className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          This is your own account.{" "}
          <Link
            href="/admin/profile"
            className="font-medium text-neutral-900 underline underline-offset-2"
          >
            Open your admin profile
          </Link>{" "}
          to see it from the same place you would as a user.
        </p>
      ) : null}

      <div className="mt-8 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Profile
        </h2>
        <div className="mt-5">
          <ProfileDetails
            profile={{
              fullName: user.fullName,
              email: user.email,
              avatarUrl: user.avatarUrl,
              provider: user.provider,
              role: user.role,
              status: user.status,
              createdAt: user.createdAt,
              lastLoginAt: user.lastLoginAt,
            }}
          />
        </div>

        <div className="mt-6 border-t border-neutral-100 pt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Last updated
          </p>
          <p className="mt-1 text-sm text-neutral-800">
            {formatProfileDateTime(user.updatedAt)}
          </p>
        </div>

        <ReadOnlyNote>
          {adminProjectionNote(user.provider)} OAuth access tokens, refresh
          tokens and provider identifiers are never stored in the application
          database and are not displayed anywhere in this panel. Administrators
          cannot change a user&rsquo;s email, and the role column is not writable
          from this screen — promote an administrator by adding their address to
          the <code>ADMIN_EMAILS</code> environment variable.
        </ReadOnlyNote>
      </div>

      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Edit display name
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          {adminNameCorrectionNote(user.provider)} This is the only field you can
          change for another account.
        </p>
        <div className="mt-5">
          <UserProfileNameForm
            action={updateUserProfileNameAction}
            userId={user.id}
            initialFullName={user.fullName}
            provider={user.provider}
          />
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Account status
        </h2>
        <p className="mt-3 text-sm text-neutral-600">
          {user.status === "suspended"
            ? "This account is suspended. It cannot search or use protected features, and the user sees a clear explanation when they try. Public activity pages remain accessible."
            : "This account is active and can search and use protected features."}
        </p>
        <p className="mt-2 text-sm text-neutral-600">
          Suspending never deletes the account or any data.
        </p>
        <div className="mt-5">
          <UserStatusForm
            userId={user.id}
            status={user.status}
            isSelf={isSelf}
            returnTo={`/admin/users/${user.id}`}
          />
        </div>
      </div>
    </div>
  );
}
