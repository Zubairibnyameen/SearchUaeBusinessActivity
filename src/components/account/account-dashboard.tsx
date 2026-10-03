/**
 * Presentational building blocks for the `/account` dashboard.
 *
 * Kept separate from the page so the capability-gating rules are written once:
 * a suspended account is told what it cannot do rather than being handed a
 * button that 403s when pressed.
 */
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  Info,
  LogOut,
  Search as SearchIcon,
  UserCog,
} from "lucide-react";
import { UserAvatar, UserRoleBadge, UserStatusBadge } from "@/components/admin/user-badges";
import {
  formatProfileDateTime,
  type ProfileCardData,
} from "@/components/profile/profile-card";
import type { AccountUsage } from "@/lib/auth/account-usage";
import { emailManagerHint } from "@/lib/auth/provider-copy";

/** One label/value tile in the account facts grid. */
function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1.5 truncate text-sm font-semibold text-neutral-900">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Identity header.
 *
 * Takes an explicit, hand-picked set of fields. `Viewer` also carries
 * `authUserId` and `id`, and this component is never given the whole object —
 * so there is no path by which a provider-internal identifier can reach the
 * markup, even by accident.
 */
export function AccountIdentityCard({
  profile,
  usage,
}: {
  profile: ProfileCardData;
  usage: AccountUsage;
}) {
  const displayName = profile.fullName?.trim() || profile.email;
  const { account } = usage;

  /*
   * Greeting.
   *
   * First name only, and only when one exists. Two reasons not to reuse
   * `displayName`:
   *
   *   - It falls back to the email address, and "Hi, someone@example.com" reads
   *     like a bug even though the address is already shown below.
   *   - A full legal or company name in a greeting is needlessly long and can
   *     wrap badly next to the avatar at 320px.
   *
   * With no full name the greeting stays generic rather than inventing one.
   */
  const firstName = profile.fullName?.trim().split(/\s+/)[0] ?? "";
  const greeting = firstName ? `Hi, ${firstName}` : "Welcome back";

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8">
      {/*
       * A <p>, not the <h1>. The page's single heading stays the account name,
       * which is what the "Your account" section below is about; adding a
       * second heading here would give the page two competing <h1>s and push
       * heading navigation to announce a greeting as a section.
       */}
      <p className="mb-5 text-sm font-medium text-neutral-500">{greeting}</p>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar
            src={profile.avatarUrl}
            name={profile.fullName}
            email={profile.email}
            size={64}
          />
          <div className="min-w-0">
            <h1 className="truncate font-heading text-2xl font-bold tracking-tight text-neutral-900">
              {displayName}
            </h1>
            <p className="truncate text-sm text-neutral-500">{profile.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <UserRoleBadge role={profile.role} />
              <UserStatusBadge status={profile.status} />
            </div>
          </div>
        </div>
      </div>

      <dl className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Full name"
          value={profile.fullName?.trim() || "Not set"}
          hint={profile.fullName?.trim() ? undefined : "Add it on your profile"}
        />
        <Stat
          label="Email"
          value={profile.email}
          hint={emailManagerHint(profile.provider)}
        />
        <Stat
          label="Member since"
          value={formatProfileDateTime(profile.createdAt)}
          hint={memberSinceLabel(account.memberForDays)}
        />
        <Stat
          label="Last login"
          value={formatProfileDateTime(profile.lastLoginAt)}
          hint={
            account.lastLoginRelative
              ? `Signed in ${account.lastLoginRelative}`
              : "Stamped at each sign-in"
          }
        />
      </dl>

      {!account.isActive ? (
        <p className="mt-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="leading-relaxed">
            This account is suspended, so searching and other protected features
            are unavailable. You can still review your details and sign out.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function memberSinceLabel(days: number): string {
  if (days === 0) return "Joined today";
  if (days === 1) return "1 day on the platform";
  return `${days} days on the platform`;
}

/**
 * Usage overview.
 *
 * The search-usage card has three distinct states, and conflating any two of
 * them would be a lie:
 *
 *   available: false        -> "we could not read this", never a zero
 *   available: true, total 0 -> a truthful "you have not searched yet"
 *   available: true, total>0 -> the real counts, always paired with the
 *                               30-day window so the numbers have a scale
 *
 * The dashboard is fed `getSearchUsageCountsSafely(viewer)`, so these are
 * genuine per-account numbers read from `search_usage` and scoped to the
 * caller's own id. No number here is derived, estimated or remembered.
 */
export function AccountUsageCard({ usage }: { usage: AccountUsage }) {
  const { profile } = usage;

  return (
    <section
      aria-labelledby="usage-heading"
      className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8"
    >
      <h2
        id="usage-heading"
        className="text-sm font-semibold uppercase tracking-wide text-neutral-500"
      >
        Usage &amp; overview
      </h2>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {/* ── Search usage: real counts, or an honest gap ─────────────── */}
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-5">
          <h3 className="text-sm font-semibold text-neutral-900">Search activity</h3>

          {!usage.searches.available ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                Search activity is unavailable right now.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-neutral-500">
                {usage.searches.reason}
              </p>
            </>
          ) : usage.searches.total === 0 ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                You haven&rsquo;t run any searches yet.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-neutral-500">
                Search the indexed activities and your own totals will build up
                here, showing only your own activity.
              </p>
            </>
          ) : (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Total searches
                  </dt>
                  <dd
                    data-testid="usage-total"
                    className="mt-1 text-2xl font-bold tracking-tight text-neutral-900"
                  >
                    {usage.searches.total.toLocaleString("en")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Last 30 days
                  </dt>
                  <dd
                    data-testid="usage-last-30"
                    className="mt-1 text-2xl font-bold tracking-tight text-neutral-900"
                  >
                    {usage.searches.last30Days.toLocaleString("en")}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-neutral-500">
                Counts the searches you ran while signed in to this account.
                Nobody else can see them.
              </p>
            </>
          )}

          {/* Only linked when the counts could be read at all. If the whole
              usage read is unavailable, the history page would be too, and
              offering the link would promise something that cannot load. */}
          {usage.searches.available ? (
            <Link
              href="/account/search-history"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900 underline underline-offset-4 transition-colors hover:text-neutral-600"
            >
              View your search history
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : null}
        </div>

        {/* ── Profile completion: genuinely derived ───────────────────── */}
        <div className="rounded-xl border border-neutral-200 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-neutral-900">Profile</h3>
            <p className="text-2xl font-bold tracking-tight text-neutral-900">
              {profile.percentComplete}%
            </p>
          </div>

          {/* Announced as a meter so the value is not colour-only. */}
          <div
            role="meter"
            aria-valuenow={profile.percentComplete}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Profile completion"
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-100"
          >
            <div
              className="h-full rounded-full bg-neutral-900"
              style={{ width: `${profile.percentComplete}%` }}
            />
          </div>

          <ul className="mt-4 space-y-2">
            {profile.items.map(item => (
              <li key={item.key} className="flex items-start gap-2 text-sm">
                {item.complete ? (
                  <CircleCheck
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-emerald-600"
                  />
                ) : (
                  <CircleDashed
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-neutral-500"
                  />
                )}
                <span className={item.complete ? "text-neutral-700" : "text-neutral-500"}>
                  <span className="font-medium text-neutral-800">{item.label}</span>
                  {!item.complete ? (
                    <span className="block text-xs">{item.hint}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * Quick actions.
 *
 * Both capability flags are passed in from the server, never inferred in the
 * client. A suspended account is shown each tile in a disabled state with the
 * reason, rather than being given a link to a page that will 403 — an honest
 * affordance beats a broken button. Viewing the profile stays available even
 * when editing it does not, so the two are separate flags.
 */
export function AccountQuickActions({
  canSearch,
  canEditProfile,
  isAdmin,
}: {
  canSearch: boolean;
  canEditProfile: boolean;
  isAdmin: boolean;
}) {
  return (
    <section
      aria-labelledby="quick-actions-heading"
      className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8"
    >
      <h2
        id="quick-actions-heading"
        className="text-sm font-semibold uppercase tracking-wide text-neutral-500"
      >
        Quick actions
      </h2>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <QuickAction
          href="/search"
          icon={<SearchIcon aria-hidden className="size-4" />}
          title="Search activities"
          description={
            canSearch
              ? "Find licences, approvals and fees across the UAE."
              : "Unavailable while your account is suspended."
          }
          disabled={!canSearch}
        />
        <QuickAction
          href="/account/profile"
          icon={<UserCog aria-hidden className="size-4" />}
          title="Your profile"
          description={
            canEditProfile
              ? "Review your details and edit your display name."
              : "Review your details. Your profile is read-only while your account is suspended."
          }
        />
        {isAdmin ? (
          <QuickAction
            href="/admin"
            icon={<ArrowUpRight aria-hidden className="size-4" />}
            title="Admin dashboard"
            description="Manage users, jurisdictions and regulatory research."
          />
        ) : null}
      </div>
    </section>
  );
}

function QuickAction({
  href,
  icon,
  title,
  description,
  disabled = false,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div
        aria-disabled="true"
        className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 opacity-70"
      >
        <p className="flex items-center gap-2 text-sm font-semibold text-neutral-500">
          <span className="text-neutral-500">{icon}</span>
          {title}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">
          {description}
        </p>
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="group rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
        <span className="text-neutral-500 transition-colors group-hover:text-neutral-900">
          {icon}
        </span>
        {title}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">
        {description}
      </p>
    </Link>
  );
}

/** Sign-out control. Posts to a server action, never a client-side token wipe. */
export function SignOutCard({ action }: { action: () => Promise<void> }) {
  return (
    <section
      aria-labelledby="session-heading"
      className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8"
    >
      <h2
        id="session-heading"
        className="text-sm font-semibold uppercase tracking-wide text-neutral-500"
      >
        Session
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-neutral-600">
        Signing out ends your Supabase session and clears the session cookies on
        this device.
      </p>
      <form action={action} className="mt-4">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
        >
          <LogOut aria-hidden className="size-4" />
          Sign out
        </button>
      </form>
    </section>
  );
}
