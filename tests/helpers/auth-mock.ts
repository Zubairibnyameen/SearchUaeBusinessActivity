/**
 * Shared authentication state for route-handler tests.
 *
 * The DAL (`@/lib/auth/viewer`) is replaced per-suite with a mock factory that
 * reads this module's mutable state, so a test can flip between
 * unauthenticated / normal-user / suspended / admin without touching Supabase
 * or the database. The rules the mock enforces are deliberately identical to
 * the real ones so a suite can never accidentally pass because the mock is more
 * permissive than production code.
 */
import type { AppUserRole, AppUserStatus } from "@/lib/db/schema";
import { vi } from "vitest";

export interface TestViewer {
  id: string;
  authUserId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  /**
   * The authentication provider that owns this identity, mirroring
   * `Viewer.provider`.
   *
   * Defaults to `"google"` because the suites that predate email + password were
   * all written describing a Google session, and their expectations must keep
   * meaning what they meant. Override it with `"email"` (or `""`) to exercise
   * the credential-based wording - which is also what an omitted value produces,
   * since `providerIdentityOf()` falls back to `"email"` when the session
   * metadata is silent.
   *
   * Unlike `authUserId` this is not a secret: the profile surfaces render it as
   * a provider badge, so it is safe to hand to component props.
   */
  provider: string;
  role: AppUserRole;
  status: AppUserStatus;
  createdAt: Date;
  lastLoginAt: Date | null;
  isAdmin: boolean;
  isActive: boolean;
}

export const authState: { viewer: TestViewer | null } = { viewer: null };

/** Reset to "no session" — the safe default for an authorization test. */
export function resetAuth(): void {
  authState.viewer = null;
}

export function makeViewer(overrides: Partial<TestViewer> = {}): TestViewer {
  const role = overrides.role ?? "user";
  const status = overrides.status ?? "active";
  return {
    id: "11111111-1111-4111-8111-111111111111",
    authUserId: "22222222-2222-4222-8222-222222222222",
    email: "user@example.com",
    fullName: "Test User",
    avatarUrl: null,
    provider: "google",
    role,
    status,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastLoginAt: new Date("2026-01-02T00:00:00.000Z"),
    isAdmin: role === "admin" && status === "active",
    isActive: status === "active",
    ...overrides,
  };
}

/** Sign in as a normal, active, non-admin user. */
export function signInAsUser(overrides: Partial<TestViewer> = {}): TestViewer {
  const viewer = makeViewer(overrides);
  authState.viewer = viewer;
  return viewer;
}

/** Sign in as a suspended, non-admin user. */
export function signInAsSuspended(
  overrides: Partial<TestViewer> = {}
): TestViewer {
  return signInAsUser({ status: "suspended", ...overrides });
}

/** Sign in as an active admin. */
export function signInAsAdmin(overrides: Partial<TestViewer> = {}): TestViewer {
  return signInAsUser({ role: "admin", ...overrides });
}

/**
 * Replacement module for `@/lib/auth/viewer`, driven by `authState`.
 *
 * Mirrors the real gate semantics exactly: no session -> 401, session but not
 * active -> 403, session but not admin -> 403. `authUserStats` / `authUserList`
 * let admin suites feed canned rows without a database.
 */
export interface UserListOptions {
  search?: string;
  role?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export const authUserStats = vi.fn(async () => ({ ...EMPTY_USER_STATS }));
export const authUserList = vi.fn(async (_options?: UserListOptions) => [] as unknown[]);
export const authUserCount = vi.fn(async (_options?: UserListOptions) => 0);

export async function authViewerMock() {
  const { AuthRequiredError, ForbiddenError } = await import(
    "@/lib/auth/errors"
  );

  const gate = async () => {
    const viewer = authState.viewer;
    if (!viewer) throw new AuthRequiredError();
    if (!viewer.isActive) throw new ForbiddenError("This account is not active");
    return viewer;
  };

  return {
    getViewer: async () => authState.viewer,
    resolveViewer: async () => authState.viewer,
    requireViewer: gate,
    requireAdmin: async () => {
      const viewer = await gate();
      if (!viewer.isAdmin) {
        throw new ForbiddenError("Administrator access is required");
      }
      return viewer;
    },
    isAdminViewer: async () => Boolean(authState.viewer?.isAdmin),
    getUserStats: authUserStats,
    listUsers: authUserList,
    countUsers: authUserCount,
  };
}

export const EMPTY_USER_STATS = {
  total: 0,
  newLast7Days: 0,
  newLast30Days: 0,
  active: 0,
  suspended: 0,
  admins: 0,
  signInsLast7Days: 0,
};
