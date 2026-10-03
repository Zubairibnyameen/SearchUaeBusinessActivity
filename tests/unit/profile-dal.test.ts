import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `profile.ts` is the only code in the app that can write a user's own profile
 * row from a request. The security property under test is not "does it store the
 * name" — it is that the UPDATE payload is a fixed literal containing no
 * privilege column, so no caller, however malformed, can widen it.
 *
 * The db mock records the exact object handed to `.set()`, which is what lets
 * these tests assert on the absence of `role`/`status` rather than trusting the
 * implementation's own comments.
 */
vi.mock("server-only", () => ({}));

const setArg = vi.fn();
const whereArg = vi.fn();
const returningArg = vi.fn();
let updateRows: unknown[] = [];

const dbMock = {
  update: () => ({
    set: (values: unknown) => {
      setArg(values);
      return {
        where: (...w: unknown[]) => {
          whereArg(...w);
          return {
            returning: (...r: unknown[]) => {
              returningArg(...r);
              return Promise.resolve(updateRows);
            },
          };
        },
      };
    },
  }),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

type Module = typeof import("@/lib/auth/profile");
let profile: Module;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "user@example.com",
    fullName: "Test User",
    avatarUrl: null,
    provider: "google",
    role: "user",
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    lastLoginAt: new Date("2026-01-03T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  updateRows = [];
  profile = await import("@/lib/auth/profile");
});

describe("updateOwnProfile", () => {
  it("writes only the name and updatedAt", async () => {
    updateRows = [row({ fullName: "New Name" })];

    const result = await profile.updateOwnProfile(USER_ID, { fullName: "New Name" });

    const written = setArg.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(["fullName", "updatedAt"]);
    expect(written.fullName).toBe("New Name");
    expect(written.updatedAt).toBeInstanceOf(Date);
    expect(result.fullName).toBe("New Name");
  });

  it("never writes role, status, email, authUserId or timestamps of record", async () => {
    updateRows = [row()];
    await profile.updateOwnProfile(USER_ID, { fullName: "Whatever" });

    const written = setArg.mock.calls[0][0] as Record<string, unknown>;
    for (const forbidden of [
      "role",
      "status",
      "email",
      "authUserId",
      "providerUserId",
      "createdAt",
      "lastLoginAt",
      "isAdmin",
      "isActive",
      "id",
    ]) {
      expect(written).not.toHaveProperty(forbidden);
    }
  });

  it("stores a cleared name as null, not an empty string", async () => {
    updateRows = [row({ fullName: null })];
    const result = await profile.updateOwnProfile(USER_ID, { fullName: "   " });
    expect((setArg.mock.calls[0][0] as Record<string, unknown>).fullName).toBeNull();
    expect(result.fullName).toBeNull();
  });

  it("trims the stored name", async () => {
    updateRows = [row({ fullName: "Trimmed" })];
    await profile.updateOwnProfile(USER_ID, { fullName: "   Trimmed   " });
    expect((setArg.mock.calls[0][0] as Record<string, unknown>).fullName).toBe("Trimmed");
  });

  it("derives isAdmin from BOTH role and status", async () => {
    updateRows = [row({ role: "admin", status: "active" })];
    const active = await profile.updateOwnProfile(USER_ID, { fullName: "A" });
    expect(active.isAdmin).toBe(true);
    expect(active.isActive).toBe(true);

    updateRows = [row({ role: "admin", status: "suspended" })];
    const suspended = await profile.updateOwnProfile(USER_ID, { fullName: "A" });
    expect(suspended.isAdmin).toBe(false);
    expect(suspended.isActive).toBe(false);
  });

  it("rejects a malformed viewer id without touching the database", async () => {
    await expect(
      profile.updateOwnProfile("not-a-uuid", { fullName: "X" })
    ).rejects.toThrow(/invalid account id/i);
    expect(dbMock.update).toBeDefined();
    expect(setArg).not.toHaveBeenCalled();
  });

  it("throws rather than silently succeeding when the row is gone", async () => {
    updateRows = [];
    await expect(
      profile.updateOwnProfile(USER_ID, { fullName: "X" })
    ).rejects.toThrow(/account not found/i);
  });
});

describe("updateUserProfileName", () => {
  it("writes only the name, even for an admin editing another user", async () => {
    updateRows = [row({ id: OTHER_ID, fullName: "Corrected" })];

    const result = await profile.updateUserProfileName({
      targetUserId: OTHER_ID,
      actingAdminId: USER_ID,
      input: { fullName: "Corrected" },
    });

    const written = setArg.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(["fullName", "updatedAt"]);
    expect(result.fullName).toBe("Corrected");
    expect(result.id).toBe(OTHER_ID);
  });

  it("cannot change status through this path", async () => {
    updateRows = [row({ id: OTHER_ID, status: "suspended" })];
    const result = await profile.updateUserProfileName({
      targetUserId: OTHER_ID,
      actingAdminId: USER_ID,
      input: { fullName: "X" },
    });
    // Status is returned for display but is nowhere in the write set.
    expect(result.status).toBe("suspended");
    expect(setArg.mock.calls[0][0]).not.toHaveProperty("status");
  });

  it("cannot change role through this path", async () => {
    updateRows = [row({ id: OTHER_ID, role: "admin" })];
    await profile.updateUserProfileName({
      targetUserId: OTHER_ID,
      actingAdminId: USER_ID,
      input: { fullName: "X" },
    });
    expect(setArg.mock.calls[0][0]).not.toHaveProperty("role");
  });

  it("allows an admin to correct their own name through the same path", async () => {
    updateRows = [row({ id: USER_ID, fullName: "Self Edit" })];
    const result = await profile.updateUserProfileName({
      targetUserId: USER_ID,
      actingAdminId: USER_ID,
      input: { fullName: "Self Edit" },
    });
    expect(result.fullName).toBe("Self Edit");
  });

  it("rejects a malformed target id before any write", async () => {
    await expect(
      profile.updateUserProfileName({
        targetUserId: "../../etc/passwd",
        actingAdminId: USER_ID,
        input: { fullName: "X" },
      })
    ).rejects.toThrow(/invalid user id/i);
    expect(setArg).not.toHaveBeenCalled();
  });

  it("rejects a malformed acting-admin id before any write", async () => {
    await expect(
      profile.updateUserProfileName({
        targetUserId: OTHER_ID,
        actingAdminId: "nope",
        input: { fullName: "X" },
      })
    ).rejects.toThrow(/invalid administrator id/i);
    expect(setArg).not.toHaveBeenCalled();
  });

  it("throws when the target row does not exist", async () => {
    updateRows = [];
    await expect(
      profile.updateUserProfileName({
        targetUserId: OTHER_ID,
        actingAdminId: USER_ID,
        input: { fullName: "X" },
      })
    ).rejects.toThrow(/user not found/i);
  });
});

describe("PROFILE_READ_COLUMNS", () => {
  it("excludes provider-internal identifiers", () => {
    const keys = Object.keys(profile.PROFILE_READ_COLUMNS);
    expect(keys).not.toContain("authUserId");
    expect(keys).not.toContain("providerUserId");
  });

  it("includes every field a profile screen needs", () => {
    const keys = Object.keys(profile.PROFILE_READ_COLUMNS);
    for (const required of [
      "id",
      "email",
      "fullName",
      "avatarUrl",
      "provider",
      "role",
      "status",
      "createdAt",
      "updatedAt",
      "lastLoginAt",
    ]) {
      expect(keys).toContain(required);
    }
  });
});
