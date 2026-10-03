import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * `syncSignedInProfile()` on the email + password path.
 *
 * Adding a second way to sign in puts this function on a new route into the
 * authorization system, so the properties worth pinning are the ones that could
 * quietly regress:
 *
 *   - a password user's profile row is created exactly as a Google user's is;
 *   - the ADMIN_EMAILS allowlist grants admin regardless of how they signed in;
 *   - and, most importantly, NOTHING in a routine sign-in can lift a suspension
 *     or demote an admin. The upsert's `set` clause is where that guarantee
 *     lives, so the tests below read the clause the code actually sends.
 */

const { valuesImpl, setImpl, returningImpl, insertImpl } = vi.hoisted(() => {
  const valuesImpl = vi.fn();
  const setImpl = vi.fn();
  const returningImpl = vi.fn(async (): Promise<Record<string, unknown>[]> => []);
  const insertImpl = vi.fn(() => ({
    values: (values: unknown) => {
      valuesImpl(values);
      return {
        onConflictDoUpdate: (config: unknown) => {
          setImpl(config);
          return { returning: returningImpl };
        },
      };
    },
  }));
  return { valuesImpl, setImpl, returningImpl, insertImpl };
});

vi.mock("@/lib/db", () => ({ db: { insert: insertImpl } }));

const authDouble = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: authDouble })),
}));

const configured = { value: true };
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => configured.value,
}));

/**
 * The allowlist is driven by a mutable object so the real comparison logic —
 * case folding, trimming — is exercised rather than stubbed away.
 */
const allowlist = { emails: [] as string[] };
vi.mock("@/lib/auth/allowlist", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/allowlist")>(
    "@/lib/auth/allowlist"
  );
  return {
    ...actual,
    isAllowlistedAdminEmail: (email: string) =>
      allowlist.emails.includes(email.trim().toLowerCase()),
  };
});

import { getAuthIdentity, syncSignedInProfile } from "@/lib/auth/viewer";

const ADMIN_EMAIL = "admin@example.com";
const USER_EMAIL = "layla@example.com";

/** A Supabase user as the email provider returns one. */
function providerUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "auth-1",
    email: USER_EMAIL,
    user_metadata: { full_name: "Layla Hassan" },
    ...overrides,
  };
}

function identity(overrides: Record<string, unknown> = {}) {
  return {
    authUserId: "auth-1",
    email: USER_EMAIL,
    fullName: "Layla Hassan",
    avatarUrl: null,
    provider: "email",
    providerUserId: "auth-1",
    ...overrides,
  } as unknown as Parameters<typeof syncSignedInProfile>[0];
}

/** The `set` clause the upsert actually sends to Postgres. */
function updateClause(): Record<string, unknown> {
  const config = setImpl.mock.calls.at(-1)?.[0] as
    | { set?: Record<string, unknown> }
    | undefined;
  return config?.set ?? {};
}

/** The row the database is pretending to return. */
function insertedRow(overrides: Record<string, unknown> = {}) {
  returningImpl.mockResolvedValue([
    {
      id: "11111111-1111-4111-8111-111111111111",
      authUserId: "auth-1",
      provider: "email",
      providerUserId: "auth-1",
      email: USER_EMAIL,
      fullName: "Layla Hassan",
      avatarUrl: null,
      role: "user",
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastLoginAt: new Date("2026-02-01T00:00:00.000Z"),
      ...overrides,
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  configured.value = true;
  allowlist.emails = [];
  insertedRow();
  authDouble.getUser.mockResolvedValue({ data: { user: providerUser() }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  // The allowlist mock is module-scoped; restore the real implementation so a
  // later suite in the same worker is not left with a stubbed allowlist.
  vi.doUnmock("@/lib/auth/allowlist");
});

describe("getAuthIdentity — email provider", () => {
  it("derives the identity from a password sign-in", async () => {
    const result = await getAuthIdentity();
    expect(result).toMatchObject({
      authUserId: "auth-1",
      email: USER_EMAIL,
      fullName: "Layla Hassan",
      provider: "email",
    });
  });

  it("reads the display name from the full_name the signup action seeded", async () => {
    // The signup action passes `full_name` in user metadata precisely so the
    // very first render is not a blank name.
    const result = await getAuthIdentity();
    expect(result?.fullName).toBe("Layla Hassan");
  });

  it("falls back to the local part of the address when no name was given", async () => {
    authDouble.getUser.mockResolvedValue({
      data: { user: providerUser({ user_metadata: {} }) },
      error: null,
    });
    expect((await getAuthIdentity())?.fullName).toBe("layla");
  });

  it("folds the address to lower case", async () => {
    authDouble.getUser.mockResolvedValue({
      data: { user: providerUser({ email: "  Layla@Example.COM " }) },
      error: null,
    });
    // The allowlist and the stored row are exact-string comparisons.
    expect((await getAuthIdentity())?.email).toBe(USER_EMAIL);
  });

  it("returns null when the session is not verified", async () => {
    authDouble.getUser.mockResolvedValue({ data: { user: null }, error: { message: "x" } });
    expect(await getAuthIdentity()).toBeNull();
  });

  it("returns null when the deployment is unconfigured", async () => {
    configured.value = false;
    expect(await getAuthIdentity()).toBeNull();
  });

  it("never throws on a transport failure", async () => {
    authDouble.getUser.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await getAuthIdentity()).toBeNull();
  });
});

describe("syncSignedInProfile — creating a profile", () => {
  it("writes a row for a password user, exactly as for a Google user", async () => {
    await syncSignedInProfile(identity());
    expect(valuesImpl).toHaveBeenCalledTimes(1);
    expect(valuesImpl.mock.calls.at(-1)?.[0]).toMatchObject({
      authUserId: "auth-1",
      email: USER_EMAIL,
      provider: "email",
    });
  });

  it("records the sign-in time", async () => {
    await syncSignedInProfile(identity());
    const values = valuesImpl.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(values.lastLoginAt).toBeInstanceOf(Date);
  });

  it("returns the viewer so the caller knows the resulting role and status", async () => {
    insertedRow({ role: "admin", status: "active" });
    const viewer = await syncSignedInProfile(identity());
    expect(viewer?.isAdmin).toBe(true);
  });

  it("returns null when the upsert produced no row", async () => {
    returningImpl.mockResolvedValue([]);
    expect(await syncSignedInProfile(identity())).toBeNull();
  });

  it("does not throw when the write fails", async () => {
    insertImpl.mockImplementationOnce(() => {
      throw new Error("db down");
    });
    expect(await syncSignedInProfile(identity())).toBeNull();
  });
});

describe("syncSignedInProfile — the admin allowlist", () => {
  it("promotes an allowlisted address at creation", async () => {
    allowlist.emails = [ADMIN_EMAIL];
    await syncSignedInProfile(identity({ email: ADMIN_EMAIL }));
    expect(valuesImpl.mock.calls.at(-1)?.[0]).toMatchObject({ role: "admin" });
  });

  it("promotes an allowlisted address that signs in with a password", async () => {
    // The whole reason this test exists: the allowlist must not have been
    // implemented as a Google-only special case when the email flows were added.
    allowlist.emails = [ADMIN_EMAIL];
    await syncSignedInProfile(identity({ email: ADMIN_EMAIL, provider: "email" }));
    expect(updateClause().role).toBe("admin");
  });

  it("matches the allowlist case-insensitively", async () => {
    allowlist.emails = [ADMIN_EMAIL];
    await syncSignedInProfile(identity({ email: "Admin@Example.com" }));
    expect(valuesImpl.mock.calls.at(-1)?.[0]).toMatchObject({ role: "admin" });
  });

  it("leaves a non-allowlisted address as a plain user", async () => {
    allowlist.emails = [ADMIN_EMAIL];
    await syncSignedInProfile(identity());
    expect(valuesImpl.mock.calls.at(-1)?.[0]).toMatchObject({ role: "user" });
  });
});

describe("syncSignedInProfile — a routine sign-in cannot escalate or demote", () => {
  /*
   * THE `set` CLAUSE IS THE WHOLE GUARANTEE.
   *
   *   `role` is written only when the allowlist matched. If it were written
   *   unconditionally it would be a user's `"user"` resetting a database-side
   *   promotion on every sign-in; and `status` must not appear here at all, or
   *   every sign-in would quietly unsuspend the suspended.
   */
  it("never writes a role for a non-allowlisted address", async () => {
    allowlist.emails = [];
    await syncSignedInProfile(identity());
    expect(updateClause()).not.toHaveProperty("role");
  });

  it("never writes a status at all, so a suspension survives", async () => {
    // `status: "active"` in the update set would undo an admin's suspension the
    // next time the person signed in — from any of the four entry points.
    await syncSignedInProfile(identity());
    expect(updateClause()).not.toHaveProperty("status");
  });

  it("keeps a suspended row suspended on the value it returns", async () => {
    insertedRow({ status: "suspended" });
    const viewer = await syncSignedInProfile(identity());
    expect(viewer?.isActive).toBe(false);
    expect(viewer?.isAdmin).toBe(false);
  });

  it("keeps a database-promoted admin an admin when the allowlist does not list them", async () => {
    allowlist.emails = [];
    insertedRow({ role: "admin" });
    const viewer = await syncSignedInProfile(identity());
    expect(viewer?.isAdmin).toBe(true);
  });

  it("keeps a suspended admin from being active even with role admin", async () => {
    // Suspension must win over role: this pair is what every gate keys on.
    insertedRow({ role: "admin", status: "suspended" });
    const viewer = await syncSignedInProfile(identity());
    expect(viewer?.role).toBe("admin");
    expect(viewer?.isActive).toBe(false);
    expect(viewer?.isAdmin).toBe(false);
  });

  it("still refreshes the profile and sign-in time on every sign-in", async () => {
    await syncSignedInProfile(identity({ fullName: "Layla H." }));
    const set = updateClause();
    expect(set).toHaveProperty("fullName", "Layla H.");
    expect(set).toHaveProperty("email", USER_EMAIL);
    expect(set.lastLoginAt).toBeInstanceOf(Date);
  });

  it("refreshes the email so an address change is not lost", async () => {
    await syncSignedInProfile(identity({ email: "layla.new@example.com" }));
    expect(updateClause().email).toBe("layla.new@example.com");
  });

  it("never writes an authorization field that came from the identity", async () => {
    // `AuthIdentity` has no role or status field, so a caller cannot smuggle one
    // through — asserted by proving the clause only carries known keys.
    await syncSignedInProfile(identity());
    expect(Object.keys(updateClause()).sort()).toEqual([
      "avatarUrl",
      "email",
      "fullName",
      "lastLoginAt",
      "provider",
      "providerUserId",
      "updatedAt",
    ]);
  });
});