/**
 * Profile data access — server-only.
 *
 * Two callers, one write path:
 *   - a person editing their OWN profile      -> `updateOwnProfile`
 *   - an administrator correcting a user's name -> `updateUserProfileName`
 *
 * SECURITY MODEL
 *   The row being written is chosen by the SERVER, never by the request:
 *   `updateOwnProfile` ignores any target id and writes to the id from the
 *   verified session. `updateUserProfileName` takes the acting administrator's
 *   id alongside the target so the audit trail and the self-target guard are
 *   both derivable server-side.
 *
 *   The UPDATE statement itself is built from a fixed literal object
 *   ({ fullName, updatedAt }) rather than from caller input, so there is no
 *   code path anywhere in this file — today or after a refactor — that can
 *   write `role` or `status`. This is deliberately stronger than validating
 *   that the client did not send them: the privilege columns are not
 *   parameterised at all.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers, type AppUserRole, type AppUserStatus } from "@/lib/db/schema";
import { ForbiddenError } from "./errors";
import { toStoredFullName, type ProfileUpdateInput } from "./profile-schema";
import { parseUserId, type AdminUserDetail } from "./admin-users";

/**
 * The columns a profile read is allowed to expose. `authUserId` and
 * `providerUserId` are provider-internal identifiers with no UI purpose and are
 * never selected here, so no code change above this file can start leaking them
 * to a profile screen.
 */
export const PROFILE_READ_COLUMNS = {
  id: appUsers.id,
  email: appUsers.email,
  fullName: appUsers.fullName,
  avatarUrl: appUsers.avatarUrl,
  provider: appUsers.provider,
  role: appUsers.role,
  status: appUsers.status,
  createdAt: appUsers.createdAt,
  updatedAt: appUsers.updatedAt,
  lastLoginAt: appUsers.lastLoginAt,
} as const;

/** Everything a profile screen needs, and nothing more. */
export interface ProfileView {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  provider: string;
  role: AppUserRole;
  status: AppUserStatus;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  /** role === 'admin' AND status === 'active' — mirrors `Viewer.isAdmin`. */
  isAdmin: boolean;
  isActive: boolean;
}

function toProfileView(row: {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  provider: string;
  role: AppUserRole;
  status: AppUserStatus;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}): ProfileView {
  const isActive = row.status === "active";
  return {
    ...row,
    isActive,
    isAdmin: isActive && row.role === "admin",
  };
}

/**
 * The ONE update shape this module is capable of writing.
 *
 * Written out as a literal rather than spread from input so that adding a
 * writable field later is a visible, reviewed edit to this object — the same
 * discipline that keeps `role` out of the admin status path.
 */
function nameOnlyUpdate(input: ProfileUpdateInput) {
  return {
    fullName: toStoredFullName(input.fullName),
    updatedAt: new Date(),
  };
}

/**
 * Update the caller's own display name.
 *
 * `viewerId` MUST come from `requireViewer()`/`requireAdmin()`, never from a
 * form field or route parameter — that is what makes this an "edit my own
 * profile" function rather than an arbitrary-row write.
 */
export async function updateOwnProfile(
  viewerId: string,
  input: ProfileUpdateInput
): Promise<ProfileView> {
  const id = parseUserId(viewerId);
  if (!id) {
    throw new ForbiddenError("Invalid account id");
  }

  const rows = await db
    .update(appUsers)
    .set(nameOnlyUpdate(input))
    .where(and(eq(appUsers.id, id)))
    .returning(PROFILE_READ_COLUMNS);

  const updated = (rows[0] as ProfileView | undefined) ?? null;
  if (!updated) {
    throw new ForbiddenError("Account not found");
  }
  return toProfileView(updated);
}

export interface AdminProfileUpdateInput {
  /** Whose row to change — validated and authorised by the caller. */
  targetUserId: string;
  /** The acting administrator, from `requireAdmin()`. */
  actingAdminId: string;
  /** Already validated by `parseProfileUpdate`. */
  input: ProfileUpdateInput;
}

/**
 * Correct another account's display name.
 *
 * Two properties worth stating explicitly:
 *   - it writes ONLY the name, so an administrator cannot use this to promote
 *     anyone, reactivate anyone, or rewrite an email address;
 *   - a self-targeted call is allowed (an admin fixing their own name is the
 *     normal case) but it goes through the same single-field path as every
 *     other write, so there is no special-cased branch to get wrong.
 *
 * Changing role or status is NOT here on purpose: status lives in
 * `admin-users.setUserStatus` with its self-suspension guard, and role is not
 * writable from the UI at all (it is granted by the `ADMIN_EMAILS` allowlist).
 */
export async function updateUserProfileName({
  targetUserId,
  actingAdminId,
  input,
}: AdminProfileUpdateInput): Promise<AdminUserDetail> {
  const id = parseUserId(targetUserId);
  if (!id) {
    throw new ForbiddenError("Invalid user id");
  }
  // The acting admin id is only validated for shape here; `requireAdmin()` has
  // already proven this session really is an administrator. Rejecting a
  // malformed one keeps the invariant "both ends of this call are real rows".
  if (!parseUserId(actingAdminId)) {
    throw new ForbiddenError("Invalid administrator id");
  }

  const rows = await db
    .update(appUsers)
    .set(nameOnlyUpdate(input))
    .where(and(eq(appUsers.id, id)))
    .returning({
      id: appUsers.id,
      email: appUsers.email,
      fullName: appUsers.fullName,
      avatarUrl: appUsers.avatarUrl,
      provider: appUsers.provider,
      role: appUsers.role,
      status: appUsers.status,
      createdAt: appUsers.createdAt,
      updatedAt: appUsers.updatedAt,
      lastLoginAt: appUsers.lastLoginAt,
    });

  const updated = (rows[0] as AdminUserDetail | undefined) ?? null;
  if (!updated) {
    throw new ForbiddenError("User not found");
  }
  return updated;
}
