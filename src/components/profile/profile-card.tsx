/**
 * Read-only presentation of an account's profile and metadata.
 *
 * Shared by `/account/profile`, `/admin/profile` and the admin user detail page
 * so the three screens cannot drift apart, and so the "which fields are
 * editable" boundary is visible in one place: this component renders every
 * protected field as text, and the caller supplies the edit affordance
 * separately.
 */
import {
  UserAvatar,
  UserRoleBadge,
  UserStatusBadge,
} from "@/components/admin/user-badges";
import {
  avatarDetailHint,
  avatarSourceHint,
  emailSourceHint,
} from "@/lib/auth/provider-copy";

export interface ProfileCardData {
  fullName: string | null;
  email: string;
  avatarUrl: string | null;
  provider: string;
  role: "user" | "admin";
  status: "active" | "suspended";
  createdAt: Date;
  lastLoginAt: Date | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * Timestamps render in the Gulf timezone because every account timestamp the
 * product shows is UAE business context. Fixed to Dubai (UTC+4, no DST) so a
 * server in any region agrees with the browser.
 */
export function formatProfileDateTime(value: Date | null, fallback = "Never"): string {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("en-AE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dubai",
  }).format(value);
}

export function formatProfileDate(value: Date | null, fallback = "—"): string {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("en-AE", {
    dateStyle: "medium",
    timeZone: "Asia/Dubai",
  }).format(value);
}

function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-neutral-800">{children}</dd>
      {hint ? <p className="mt-0.5 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Avatar + identity header.
 *
 * `title` is the heading and `subtitle` the line under it, so a caller can show
 * either a person's name (the admin viewing someone else) or a page name (a
 * person viewing their own account) without this component guessing. The same
 * facts render either way — `isSelf` only affects the wording a caller passes.
 */
export function ProfileHeader({
  profile,
  title,
  subtitle,
  trailing,
}: {
  profile: ProfileCardData;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <UserAvatar
          src={profile.avatarUrl}
          name={profile.fullName}
          email={profile.email}
          size={64}
        />
        <div className="min-w-0">
          <h1 className="truncate font-heading text-2xl font-bold tracking-tight text-neutral-900">
            {title}
          </h1>
          {subtitle ? (
            <p className="truncate text-sm text-neutral-500">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {trailing}
        <UserRoleBadge role={profile.role} />
        <UserStatusBadge status={profile.status} />
      </div>
    </div>
  );
}

/**
 * The full metadata grid.
 *
 * Every protected field appears here as a value with an explicit note about who
 * controls it, so a user is never left guessing whether a field would change if
 * they edited it.
 */
export function ProfileDetails({ profile }: { profile: ProfileCardData }) {
  return (
    <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2">
      <Row label="Full name" hint="Editable below.">
        {profile.fullName?.trim() || "Not set"}
      </Row>
      <Row label="Email" hint={emailSourceHint(profile.provider)}>
        {profile.email}
      </Row>
      <Row label="Account role" hint="Granted by the administrator allowlist.">
        {profile.role === "admin" ? "Administrator" : "Standard user"}
      </Row>
      <Row label="Account status" hint="Managed by an administrator.">
        {profile.status === "suspended" ? "Suspended" : "Active"}
      </Row>
      <Row label="Sign-in provider">{providerLabel(profile.provider)}</Row>
      <Row label="Account created" hint="Cannot be changed.">
        {formatProfileDateTime(profile.createdAt)}
      </Row>
      <Row label="Last login" hint="Stamped on every sign-in.">
        {formatProfileDateTime(profile.lastLoginAt)}
      </Row>
      <Row
        label="Profile picture"
        hint={avatarSourceHint(profile.provider)}
      >
        {avatarDetailHint(profile.provider, Boolean(profile.avatarUrl))}
      </Row>
    </dl>
  );
}

/**
 * A field that is visible but not editable, rendered with a lock affordance.
 * Used for account id / provider ids on the admin screens so a reader can tell
 * "not shown" apart from "shown but read-only".
 */
export function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-6 border-t border-neutral-100 pt-5 text-xs leading-relaxed text-neutral-500">
      {children}
    </p>
  );
}
