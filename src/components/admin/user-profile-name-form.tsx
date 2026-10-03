"use client";

import {
  ProfileNameForm,
  type ProfileActionState,
} from "@/components/profile/profile-name-form";
import { adminEmailOwnershipClause } from "@/lib/auth/provider-copy";

/**
 * Administrator-side correction of a user's DISPLAY NAME.
 *
 * A thin wrapper over the shared `ProfileNameForm` so the user profile, the
 * admin's own profile and this screen cannot drift apart in validation or
 * reporting — the only difference is the `userId` structural field.
 *
 * `userId` rides in a hidden input, but it is never an authorization input: the
 * action re-runs `requireAdmin()`, validates the id's shape, and the UPDATE
 * writes only `full_name`. An administrator therefore cannot use this form to
 * change a role, a status or an email address, and pointing it at their own row
 * is the same single-column write as everything else.
 */
export function UserProfileNameForm({
  action,
  userId,
  initialFullName,
  provider,
  disabled,
  disabledReason,
}: {
  action: (
    prev: ProfileActionState,
    formData: FormData
  ) => Promise<ProfileActionState>;
  userId: string;
  initialFullName: string | null;
  /**
   * The subject account's authentication provider, taken from
   * `AdminUserDetail.provider`.
   *
   * Used only to word the hint accurately. It is never inferred from the
   * address, the display name or the avatar, and an absent value falls back to
   * the neutral phrasing rather than defaulting to Google - see
   * `lib/auth/provider-copy.ts`.
   */
  provider: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <ProfileNameForm
      action={action}
      initialFullName={initialFullName}
      canSubmit={!disabled}
      lockedReason={disabledReason}
      submitLabel="Save name"
      fieldId={`user-name-${userId}`}
      hiddenFields={{ userId }}
      hint={
        <>
          The only field an administrator can change for another account. Role
          comes from the <code>ADMIN_EMAILS</code> allowlist, status is managed
          below, and {adminEmailOwnershipClause(provider)}.
        </>
      }
    />
  );
}
