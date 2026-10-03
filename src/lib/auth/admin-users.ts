/**
 * Admin user management — server-only.
 *
 * Every function here is a privileged operation. The CALLER is responsible for
 * having already run `requireAdmin()`; nothing in this module re-derives
 * identity, and nothing accepts a caller-supplied role, email or user id for
 * authorization purposes.
 *
 * SELECTION IS DELIBERATELY EXPLICIT. `app_users` will eventually grow columns
 * (plan, billing id, last ip, notes). Dumping `select()` would hand every one
 * of them to the admin JSON API, so each projection below lists exactly the
 * fields the UI needs. Nothing here ever selects, returns or logs a provider
 * token, and `authUserId` / `providerUserId` are omitted from the detail view
 * because they are provider-internal identifiers with no UI purpose.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers, type AppUserStatus } from "@/lib/db/schema";
import { parseUuid } from "@/lib/db/uuid";
import { ForbiddenError } from "./errors";

/** Columns safe to return to an authenticated administrator. */
const USER_DETAIL_COLUMNS = {
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

export interface AdminUserDetail {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  provider: string;
  role: "user" | "admin";
  status: AppUserStatus;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

/**
 * Validate a user id taken from a route parameter or JSON body.
 * Returns null when the value could never be a real `app_users.id`, which is
 * what stops a caller from probing arbitrary ids.
 *
 * Delegates to the shared `parseUuid` so the id-shape rule has exactly one
 * definition, shared with the admin research and review routes.
 */
export function parseUserId(raw: unknown): string | null {
  return parseUuid(raw);
}

/**
 * Fetch one user by id.
 *
 * Returns null when the id is malformed OR no such row exists — the two cases
 * are deliberately indistinguishable so the endpoint cannot be used to
 * enumerate which ids exist.
 */
export async function getAdminUserById(
  rawId: string
): Promise<AdminUserDetail | null> {
  const id = parseUserId(rawId);
  if (!id) return null;

  const rows = await db
    .select(USER_DETAIL_COLUMNS)
    .from(appUsers)
    .where(eq(appUsers.id, id))
    .limit(1);

  return (rows[0] as AdminUserDetail | undefined) ?? null;
}

export interface SetUserStatusInput {
  userId: string;
  status: AppUserStatus;
  /** The acting administrator — used for the last-writer guard below. */
  actingAdminId: string;
}

/**
 * Suspend or reactivate a user.
 *
 * Users are never deleted: `app_users` rows are the audit trail of who used
 * the product, and the provider account itself is Google's to manage.
 *
 * Two guards:
 *   - an admin cannot suspend or reactivate themselves, which is the cheapest
 *     way to avoid an admin locking the last administrator out of the product;
 *   - the role column is NOT writable from this path at all, so no request can
 *     promote a user to admin, even one that somehow reached this function.
 */
export async function setUserStatus({
  userId,
  status,
  actingAdminId,
}: SetUserStatusInput): Promise<AdminUserDetail> {
  const id = parseUserId(userId);
  if (!id) {
    throw new ForbiddenError("Invalid user id");
  }
  if (id === actingAdminId) {
    throw new ForbiddenError("You cannot change your own account status");
  }
  if (status !== "active" && status !== "suspended") {
    throw new ForbiddenError("Invalid status");
  }

  const rows = await db
    .update(appUsers)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(appUsers.id, id)))
    .returning(USER_DETAIL_COLUMNS);

  const updated = (rows[0] as AdminUserDetail | undefined) ?? null;
  if (!updated) {
    throw new ForbiddenError("User not found");
  }
  return updated;
}
