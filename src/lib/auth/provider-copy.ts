/**
 * Provider-aware wording for the account and profile surfaces.
 *
 * WHY THIS EXISTS
 *   The account UI asserted that every account's email and avatar came from
 *   Google ("Synced from Google", "Managed by Google", "Provided by Google").
 *   That was true when Google was the only way to create an account, and became
 *   false the moment email + password sign-up shipped: a password user's email
 *   is not owned by Google and their avatar is not provided by it. The UI was
 *   stating something untrue about them.
 *
 * WHERE THE PROVIDER COMES FROM
 *   `Viewer.provider` / `ProfileCardData.provider`, which is the provider string
 *   recorded in `app_users` by `providerIdentityOf()` in `lib/auth/viewer.ts`
 *   from the verified session's identities. It is the same value the admin
 *   screens already render as a provider badge, so this adds no new data and no
 *   new column - it only reads what is already there.
 *
 * NEVER ASSUMES GOOGLE
 *   This module is deliberately fail-closed toward neutral wording. It does not
 *   infer the provider from the email domain (an `@gmail.com` address can belong
 *   to a password account), and it does not infer it from the presence of an
 *   avatar (a password account may have one, and a Google account may not).
 *   Anything that is not positively, case-insensitively `google` - including
 *   `null`, `undefined`, an empty string, or an unrecognised provider - is
 *   treated as "not Google" and gets the neutral phrasing.
 */

/** The only provider whose ownership of the email/avatar can be asserted. */
const GOOGLE = "google";

/**
 * Whether this session came through Google.
 *
 * Exported so callers can branch on one definition. `String(...).trim().toLowerCase()`
 * means a row that predates normalisation, or was written with different casing,
 * still resolves correctly instead of silently falling into the neutral wording.
 */
export function isGoogleProvider(
  provider: string | null | undefined
): boolean {
  return (
    typeof provider === "string" && provider.trim().toLowerCase() === GOOGLE
  );
}

/**
 * Hint for the profile card's Email row.
 *
 * The Google wording is unchanged from what shipped. Every other provider gets
 * wording that is true for a credential-based account without claiming anything
 * about where the address lives or who may change it.
 */
export function emailSourceHint(provider: string | null | undefined): string {
  return isGoogleProvider(provider)
    ? "Synced from Google. Change it in your Google account."
    : "Used to sign in to your account.";
}

/**
 * Hint for the dashboard's Email stat.
 *
 * Kept separate from `emailSourceHint()` on purpose: the dashboard and the
 * profile card word this fact differently today, and both existing phrasings
 * are correct for a Google account. Collapsing them into one string would be a
 * cosmetic change to shipped UI that no one asked for, so each surface keeps its
 * own Google wording and only the non-Google branch is new.
 */
export function emailManagerHint(provider: string | null | undefined): string {
  return isGoogleProvider(provider)
    ? "Managed by Google"
    : "Managed by your account";
}

/** Hint for the profile card's Profile picture row. */
export function avatarSourceHint(provider: string | null | undefined): string {
  return isGoogleProvider(provider)
    ? "Provided by Google."
    : "Provided by your account.";
}

/**
 * Detail line for the profile card's Profile picture row.
 *
 * The fallback when there is no image is already provider-neutral, so it is the
 * same for every provider.
 */
export function avatarDetailHint(
  provider: string | null | undefined,
  hasAvatar: boolean
): string {
  if (!hasAvatar) return "None — showing initials";
  return isGoogleProvider(provider)
    ? "Shown from your Google account"
    : "Shown from your account";
}

/**
 * The ownership clause on the `/account` page's read-only paragraph.
 *
 * Like `emailManagerHint()`, this keeps the page's existing Google wording and
 * only adds a branch for credential-based accounts.
 */
export function accountFieldOwnershipNote(
  provider: string | null | undefined
): string {
  return isGoogleProvider(provider)
    ? "Email and profile picture belong to Google"
    : "Email and profile picture are managed by your account";
}

/**
 * The ownership paragraph on `/account/profile`, which additionally tells the
 * reader where to make a change.
 *
 * Only the Google variant can name somewhere to go: telling a password user to
 * "edit them in your Google account" is the exact bug this module removes, so
 * the non-Google variant asserts only what is true - that the fields are not
 * editable on this page.
 */
export function profileReadOnlyNote(
  provider: string | null | undefined
): string {
  return isGoogleProvider(provider)
    ? "Your email address, profile picture and sign-in provider belong to Google and are re-synced on every sign-in — edit them in your Google account, not here."
    : "Your email address, profile picture and sign-in provider are managed by your account and cannot be changed here.";
}

/**
 * The projection note on the ADMIN user-detail panel.
 *
 * "Projected from Google on every sign-in" is only true for a Google account: a
 * password account's email is set at sign-up and is not re-projected from any
 * identity provider, so claiming otherwise tells an administrator something
 * false about how that user's row is maintained.
 */
export function adminProjectionNote(
  provider: string | null | undefined
): string {
  return isGoogleProvider(provider)
    ? "Name, email and avatar are projected from Google on every sign-in."
    : "Name, email and avatar are recorded when the account signs in.";
}

/**
 * The lead-in to the admin "Edit display name" panel.
 *
 * Only a Google account can arrive with a name the provider got wrong in a
 * Google-specific way, so the Google variant keeps naming Google; the neutral
 * variant describes the same correction without attributing the source.
 */
export function adminNameCorrectionNote(
  provider: string | null | undefined
): string {
  return isGoogleProvider(provider)
    ? "Correct a name that came through from Google incomplete or misspelled."
    : "Correct a name that was recorded incomplete or misspelled.";
}

/**
 * The email-ownership clause in the admin name-edit form's hint.
 *
 * The sentence is a clause inside a larger JSX paragraph, so it is returned
 * without a trailing period - see `user-profile-name-form.tsx`.
 */
export function adminEmailOwnershipClause(
  provider: string | null | undefined
): string {
  return isGoogleProvider(provider)
    ? "email is owned by Google"
    : "email is managed by the user's account";
}
