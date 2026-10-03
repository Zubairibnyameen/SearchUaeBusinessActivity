import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { getAccountUsageWithSearchCounts } from "@/lib/auth/account-usage";
import { getSearchUsageCountsSafely } from "@/lib/auth/search-usage";
import { accountFieldOwnershipNote } from "@/lib/auth/provider-copy";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import {
  AccountIdentityCard,
  AccountQuickActions,
  AccountUsageCard,
  SignOutCard,
} from "@/components/account/account-dashboard";
import { signOutAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your account",
  description: "Your UAE Activity Intelligence account dashboard.",
  robots: { index: false, follow: false },
};

/**
 * The signed-in account dashboard.
 *
 * AUTHORIZATION
 *   `getViewer()` resolves identity from the verified Supabase session and
 *   nothing else. The page takes NO parameters — no id, no query string, no
 *   route segment — so there is no client-controlled input that could point it
 *   at another person's record. Every value rendered below came out of the
 *   caller's own `app_users` row.
 *
 * SUSPENDED ACCOUNTS
 *   A suspended viewer still has a valid provider session, so this page renders:
 *   they need somewhere to read why searching is unavailable and to sign out.
 *   What they must NOT get is a capability they cannot exercise, so the search
 *   and profile-edit quick actions are gated on `viewer.isActive` and render
 *   disabled rather than linking to a 403. The server-side gate in
 *   `requireViewer()` is the real enforcement; this only stops the UI from
 *   offering a dead end.
 *
 *   The suspension message lives in the identity card rather than in
 *   `AccountSuspendedNotice`, whose `inline` variant links back to `/account` —
 *   a self-link on this page, and less specific about what is blocked here.
 *   For the same reason the "sign in with a different account" prompt is hidden
 *   while suspended: re-authenticating cannot lift a suspension, so it would only
 *   sign the person straight back into the same locked account.
 */
export default async function AccountPage() {
  const viewer = await getViewer();

  // No session: nothing personal to render. Send them to sign in and back.
  if (!viewer) {
    redirect(`/signin?next=${encodeURIComponent("/account")}`);
  }

  // Real search counts for THIS account, read from `search_usage` scoped to
  // `viewer.id`. Returns `null` if the read fails, which the dashboard renders
  // as "unavailable" rather than as a zero. A suspended account still sees its
  // own history — it is their data — but records no new searches.
  const searchCounts = await getSearchUsageCountsSafely(viewer);
  const usage = getAccountUsageWithSearchCounts(viewer, searchCounts);

  // Hand-picked projection. `viewer.id` and `viewer.authUserId` are
  // deliberately NOT spread into anything rendered or passed to a component.
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
      <div className="mx-auto max-w-4xl px-6 py-12">
        {!isSupabaseConfigured() ? (
          <p
            role="alert"
            className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            Google sign-in is not configured on this deployment, so your account
            cannot be loaded.
          </p>
        ) : null}

        <AccountIdentityCard profile={profile} usage={usage} />

        <div className="mt-6 space-y-6">
          <AccountUsageCard usage={usage} />
          <AccountQuickActions
            canSearch={viewer.isActive}
            canEditProfile={viewer.isActive && isSupabaseConfigured()}
            isAdmin={viewer.isAdmin}
          />
          <SignOutCard action={signOutAction} />
        </div>

        {/* ── What you can and cannot change here ──────────────────────── */}
        <p className="mt-6 text-xs leading-relaxed text-neutral-500">
          Your display name is the only field you can change, on your{" "}
          <Link
            href="/account/profile"
            className="underline underline-offset-2 hover:text-neutral-700"
          >
            profile page
          </Link>
          . {accountFieldOwnershipNote(viewer.provider)}; your role and account
          status are assigned by an administrator. No authentication tokens, OAuth
          secrets or session credentials are ever shown on this page or sent to
          your browser.
        </p>

        {isSupabaseConfigured() && viewer.isActive ? (
          <div className="mt-10 border-t border-neutral-200 pt-8">
            <h2 className="text-sm font-semibold text-neutral-900">
              Signed in with a different account?
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Logging out returns you here. You can then sign in with another
              Google account.
            </p>
            <GoogleSignInButton
              nextPath="/account"
              size="md"
              label="Sign in with another Google account"
              className="mt-4 max-w-sm"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
