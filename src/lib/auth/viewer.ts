/**
 * Data Access Layer for identity and authorization — server-only module.
 *
 * This is the SINGLE source of truth for "who is the caller?" and "may they
 * do this?". Nothing in this file trusts the client: the identity comes from
 * the auth provider's verified session, the role comes from a server-side
 * allowlist and/or a server-side database column.
 *
 * Layering (deliberately explicit):
 *
 *   provider session  ──►  identity      (auth provider, verified)
 *   identity          ──►  app_users row (our Postgres, profile + role)
 *   app_users.role  ∪  ADMIN_EMAILS  ──►  authorization decision
 *
 * Because the allowlist and the role column are only ever read here, a client
 * cannot escalate by tampering with localStorage, hidden buttons, query
 * parameters or a client-supplied user id — none of those are ever read.
 */
import "server-only";

import { cache } from "react";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import type { User } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { appUsers, type AppUserRole, type AppUserStatus } from "@/lib/db/schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isAllowlistedAdminEmail } from "./allowlist";
import { AuthRequiredError, ForbiddenError } from "./errors";

/** Identity as asserted by the authentication provider, nothing more. */
export interface AuthIdentity {
  /** Provider-issued user id. Unique, immutable, not user-supplied. */
  authUserId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  provider: string;
  providerUserId: string;
}

/** The resolved caller used across server components and route handlers. */
export interface Viewer {
  /** app_users.id — our own key, never accepted from a request. */
  id: string;
  authUserId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  /** Authentication provider that owns the identity, e.g. 'google'. */
  provider: string;
  role: AppUserRole;
  status: AppUserStatus;
  createdAt: Date;
  lastLoginAt: Date | null;
  /** role === 'admin' AND status === 'active' */
  isAdmin: boolean;
  /** status === 'active' — suspended accounts lose product access. */
  isActive: boolean;
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Extract the provider + provider subject id from the verified Supabase user.
 * Never stores any token, secret or credential.
 */
/**
 * Which provider this session came through, and its subject id there.
 *
 * `identities` is preferred, with `google` looked for first so a person who has
 * linked a Google account to the same address is recorded under the identity
 * they will keep using. `app_metadata.provider` is the fallback.
 *
 * THE FINAL FALLBACK IS `"email"`, NOT `"google"`.
 *   This module predates email + password, when Google was the only way in, and
 *   defaulted to it. With password sign-in now available that default would
 *   mislabel a password user as a Google user in `app_users` — writing a
 *   provider that never issued the session. `"email"` is the only other provider
 *   this application can authenticate with, so it is the honest default when the
 *   metadata is silent.
 */
function providerIdentityOf(user: User): { provider: string; providerUserId: string } {
  const identity =
    user.identities?.find(i => i.provider === "google") ?? user.identities?.[0];
  const provider =
    identity?.provider ??
    (typeof user.app_metadata?.provider === "string"
      ? user.app_metadata.provider
      : "email");
  return {
    provider: truncate(String(provider), 50),
    providerUserId: truncate(
      String(identity?.identity_id ?? identity?.id ?? user.id),
      255
    ),
  };
}

/**
 * Verify the caller's session against the authentication provider.
 * Returns null when there is no valid session. Never throws.
 */
export async function getAuthIdentity(): Promise<AuthIdentity | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser();

    // `getUser()` revalidates with the provider; a forged/absent token fails.
    if (error || !data.user) return null;

    const email = normalizeEmail(data.user.email);
    if (!email) return null;

    const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
    const rawName =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      data.user.email?.split("@")[0] ||
      null;
    const rawAvatar =
      (typeof meta.avatar_url === "string" && meta.avatar_url) ||
      (typeof meta.picture === "string" && meta.picture) ||
      null;

    const { provider, providerUserId } = providerIdentityOf(data.user);

    return {
      authUserId: data.user.id,
      email,
      fullName: rawName ? truncate(rawName, 255) : null,
      avatarUrl: rawAvatar,
      provider,
      providerUserId,
    };
  } catch (err) {
    // Never leak provider/transport internals; treat as unauthenticated.
    console.error("[auth] session verification failed:", err);
    return null;
  }
}

/**
 * Project a verified identity into `app_users` and stamp the sign-in.
 *
 * Called from the OAuth callback (exactly once per sign-in) and as a
 * self-healing fallback if a row is ever missing.
 *
 * Role merge rule — allowlist PROMOTES, never DEMOTES:
 *   - allowlisted email            -> role 'admin'
 *   - not allowlisted              -> keep whatever the database already says
 *                                     (so an admin promoted in the database
 *                                      is not silently downgraded)
 */
export async function syncSignedInProfile(
  identity: AuthIdentity
): Promise<Viewer | null> {
  const allowlisted = isAllowlistedAdminEmail(identity.email);

  try {
    const inserted = await db
      .insert(appUsers)
      .values({
        authUserId: identity.authUserId,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        email: identity.email,
        fullName: identity.fullName,
        avatarUrl: identity.avatarUrl,
        role: allowlisted ? "admin" : "user",
        status: "active",
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appUsers.authUserId,
        set: {
          provider: identity.provider,
          providerUserId: identity.providerUserId,
          email: identity.email,
          fullName: identity.fullName,
          avatarUrl: identity.avatarUrl,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
          // Only ever escalate here.
          ...(allowlisted ? { role: "admin" as const } : {}),
        },
      })
      .returning();

    return inserted[0] ? toViewer(inserted[0]) : null;
  } catch (err) {
    // A profile-projection failure must not silently grant or deny access in
    // an unlogged way: surface it and let the caller fail closed.
    console.error("[auth] failed to sync user profile:", err);
    return null;
  }
}

type AppUserRow = typeof appUsers.$inferSelect;

function toViewer(row: AppUserRow): Viewer {
  const isActive = row.status === "active";
  return {
    id: row.id,
    authUserId: row.authUserId,
    email: row.email,
    fullName: row.fullName,
    avatarUrl: row.avatarUrl,
    provider: row.provider,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    isAdmin: isActive && row.role === "admin",
    isActive,
  };
}

/**
 * Resolve the caller. Memoized per render pass so a layout, page and its
 * children cost a single session verification instead of three.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const identity = await getAuthIdentity();
  if (!identity) return null;

  try {
    const rows = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.authUserId, identity.authUserId))
      .limit(1);

    const row = rows[0];
    // Self-heal: a session with no profile row means the projection was lost
    // (e.g. the row was deleted while the provider session stayed valid).
    if (!row) return await syncSignedInProfile(identity);

    return toViewer(row);
  } catch (err) {
    console.error("[auth] failed to load user profile:", err);
    return null;
  }
});

/** Uncached variant for Route Handlers / Server Actions. */
export async function resolveViewer(): Promise<Viewer | null> {
  const identity = await getAuthIdentity();
  if (!identity) return null;

  try {
    const rows = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.authUserId, identity.authUserId))
      .limit(1);

    return rows[0] ? toViewer(rows[0]) : await syncSignedInProfile(identity);
  } catch (err) {
    console.error("[auth] failed to load user profile:", err);
    return null;
  }
}

/**
 * Authentication gate. Throws 401 unless there is a verified, active session.
 * Use in route handlers and server actions.
 */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await resolveViewer();
  if (!viewer) throw new AuthRequiredError();
  if (!viewer.isActive) throw new ForbiddenError("This account is not active");
  return viewer;
}

/**
 * Authorization gate. Throws 401 when unauthenticated, 403 when the caller is
 * authenticated but not an admin. Use in every admin route handler and admin
 * server action — never rely on a client-side role check.
 */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) {
    throw new ForbiddenError("Administrator access is required");
  }
  return viewer;
}

/**
 * Safe boolean variant for use in server components that need to decide what
 * to render. Performs the exact same server-side checks as requireAdmin();
 * the only difference is that it does not throw.
 */
export async function isAdminViewer(): Promise<boolean> {
  const viewer = await getViewer();
  return viewer?.isAdmin ?? false;
}

/** Counts for the admin dashboard. Admin-only; never expose to normal users. */
export interface UserStats {
  total: number;
  newLast7Days: number;
  newLast30Days: number;
  active: number;
  suspended: number;
  admins: number;
  signInsLast7Days: number;
}

export async function getUserStats(): Promise<UserStats> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totals, new7, new30, byStatus, byRole, signIns7] = await Promise.all([
    db.select({ n: count() }).from(appUsers),
    db
      .select({ n: count() })
      .from(appUsers)
      .where(sql`${appUsers.createdAt} >= ${sevenDaysAgo}`),
    db
      .select({ n: count() })
      .from(appUsers)
      .where(sql`${appUsers.createdAt} >= ${thirtyDaysAgo}`),
    db
      .select({ status: appUsers.status, n: count() })
      .from(appUsers)
      .groupBy(appUsers.status),
    db
      .select({ role: appUsers.role, n: count() })
      .from(appUsers)
      .groupBy(appUsers.role),
    db
      .select({ n: count() })
      .from(appUsers)
      .where(
        and(isNotNull(appUsers.lastLoginAt), sql`${appUsers.lastLoginAt} >= ${sevenDaysAgo}`)
      ),
  ]);

  const statusMap = Object.fromEntries(byStatus.map(r => [r.status, r.n]));
  const roleMap = Object.fromEntries(byRole.map(r => [r.role, r.n]));

  return {
    total: totals[0]?.n ?? 0,
    newLast7Days: new7[0]?.n ?? 0,
    newLast30Days: new30[0]?.n ?? 0,
    active: statusMap.active ?? 0,
    suspended: statusMap.suspended ?? 0,
    admins: roleMap.admin ?? 0,
    signInsLast7Days: signIns7[0]?.n ?? 0,
  };
}

/**
 * Shared filter construction for `listUsers` / `countUsers`, so a paginated
 * table and its page count can never disagree.
 *
 * `search` is bound as a parameter and length-capped; `role` / `status` are
 * matched against their literal enum members, so an arbitrary value from the
 * query string simply fails the check and filters nothing.
 */
function buildUserFilters(options?: {
  search?: string;
  role?: string;
  status?: string;
}) {
  const conditions = [];
  const search = options?.search?.trim().slice(0, 200) ?? "";

  if (search) {
    const pattern = `%${search.toLowerCase()}%`;
    conditions.push(
      sql`lower(${appUsers.email}) like ${pattern} or lower(coalesce(${appUsers.fullName}, '')) like ${pattern}`
    );
  }
  if (options?.role === "user" || options?.role === "admin") {
    conditions.push(eq(appUsers.role, options.role));
  }
  if (options?.status === "active" || options?.status === "suspended") {
    conditions.push(eq(appUsers.status, options.status));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * Total number of users matching the same filters as `listUsers`, so a paginated
 * admin table knows how many pages exist. Deliberately shares the filter
 * construction with `listUsers` via `buildUserFilters` so the two can never
 * disagree about what "filtered" means.
 */
export async function countUsers(options?: {
  search?: string;
  role?: string;
  status?: string;
}): Promise<number> {
  const where = buildUserFilters(options);
  const rows = await db
    .select({ n: count() })
    .from(appUsers)
    .where(where);
  return rows[0]?.n ?? 0;
}

/**
 * User list for the admin dashboard. Server-side search/filter, bounded page
 * size, and an explicit column selection so no future column is leaked by
 * accident.
 */
export async function listUsers(options?: {
  search?: string;
  role?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const offset = Math.max(options?.offset ?? 0, 0);
  const where = buildUserFilters(options);

  return db
    .select({
      id: appUsers.id,
      fullName: appUsers.fullName,
      email: appUsers.email,
      avatarUrl: appUsers.avatarUrl,
      provider: appUsers.provider,
      role: appUsers.role,
      status: appUsers.status,
      createdAt: appUsers.createdAt,
      lastLoginAt: appUsers.lastLoginAt,
    })
    .from(appUsers)
    .where(where)
    .orderBy(sql`${appUsers.createdAt} desc`)
    .limit(limit)
    .offset(offset);
}
