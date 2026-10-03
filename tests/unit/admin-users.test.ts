import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `admin-users.ts` is the only place that selects from `app_users` for the admin
 * UI, so its projection is a security boundary: `app_users` will grow columns
 * over time, and a bare `select()` would hand every one of them to the admin API.
 * These tests pin the projection and the write guards.
 */

vi.mock("server-only", () => ({}));

const selectArg = vi.fn();
const setArg = vi.fn();
const whereArg = vi.fn();
const fromArg = vi.fn();
const limitArg = vi.fn();
const returningArg = vi.fn();

let updateRows: unknown[] = [];
let selectRows: unknown[] = [];

const dbMock = {
  select: (...args: unknown[]) => {
    selectArg(...args);
    return {
      from: (...a: unknown[]) => {
        fromArg(...a);
        return {
          where: (...w: unknown[]) => {
            whereArg(...w);
            return {
              limit: (...l: unknown[]) => {
                limitArg(...l);
                return Promise.resolve(selectRows);
              },
            };
          },
        };
      },
    };
  },
  update: (...args: unknown[]) => {
    setArg(...args);
    return {
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
    };
  },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

type Module = typeof import("@/lib/auth/admin-users");

let adminUsers: Module;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(async () => {
  vi.clearAllMocks();
  selectRows = [];
  updateRows = [];
  vi.resetModules();
  adminUsers = await import("@/lib/auth/admin-users");
});

describe("parseUserId", () => {
  it("accepts a UUID and normalises case", () => {
    expect(adminUsers.parseUserId(USER_ID.toUpperCase())).toBe(USER_ID);
  });

  it("rejects anything that could not be a real id", () => {
    for (const bad of [
      "",
      "not-a-uuid",
      "1 OR 1=1",
      "../../etc/passwd",
      "<script>",
      "11111111-1111-4111-8111-11111111111",   // too short
      "11111111-1111-4111-8111-1111111111111", // too long
    ]) {
      expect(adminUsers.parseUserId(bad)).toBeNull();
    }
  });

  it("rejects non-strings without coercing them", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(adminUsers.parseUserId(bad)).toBeNull();
    }
  });
});

describe("getAdminUserById projection", () => {
  it("selects an explicit column list, never a bare select()", async () => {
    await adminUsers.getAdminUserById(USER_ID);
    expect(selectArg).toHaveBeenCalledTimes(1);
    const columns = selectArg.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(columns).length).toBeGreaterThan(0);
  });

  it("omits every provider-internal identifier", async () => {
    await adminUsers.getAdminUserById(USER_ID);
    const columns = selectArg.mock.calls[0][0] as Record<string, unknown>;
    const keys = Object.keys(columns);
    expect(keys).not.toContain("authUserId");
    expect(keys).not.toContain("providerUserId");
    expect(keys).not.toContain("providerToken");
    expect(keys).not.toContain("lastIp");
    expect(keys).not.toContain("notes");
  });

  it("returns only the documented UI fields", async () => {
    await adminUsers.getAdminUserById(USER_ID);
    const columns = Object.keys(
      selectArg.mock.calls[0][0] as Record<string, unknown>
    );
    expect(columns.sort()).toEqual(
      [
        "avatarUrl",
        "createdAt",
        "email",
        "fullName",
        "id",
        "lastLoginAt",
        "provider",
        "role",
        "status",
        "updatedAt",
      ].sort()
    );
  });

  it("returns null without querying for a malformed id", async () => {
    expect(await adminUsers.getAdminUserById("nope")).toBeNull();
    expect(selectArg).not.toHaveBeenCalled();
  });

  it("returns null when no row exists", async () => {
    expect(await adminUsers.getAdminUserById(USER_ID)).toBeNull();
  });
});

describe("setUserStatus guards", () => {
  it("refuses to change the acting admin's own status", async () => {
    // The cheap protection against an admin locking the last administrator out.
    await expect(
      adminUsers.setUserStatus({
        userId: USER_ID,
        status: "suspended",
        actingAdminId: USER_ID,
      })
    ).rejects.toThrow(/own account status/i);
    expect(selectArg).not.toHaveBeenCalled();
  });

  it("rejects an invalid id before touching the database", async () => {
    await expect(
      adminUsers.setUserStatus({
        userId: "nope",
        status: "suspended",
        actingAdminId: OTHER_ID,
      })
    ).rejects.toThrow();
    expect(setArg).not.toHaveBeenCalled();
  });

  it("rejects a status outside the allowed set", async () => {
    await expect(
      adminUsers.setUserStatus({
        userId: USER_ID,
        status: "deleted" as never,
        actingAdminId: OTHER_ID,
      })
    ).rejects.toThrow(/Invalid status/i);
    expect(setArg).not.toHaveBeenCalled();
  });

  it("never writes the role column", async () => {
    updateRows = [{ id: USER_ID, role: "user", status: "suspended" }];
    await adminUsers.setUserStatus({
      userId: USER_ID,
      status: "suspended",
      actingAdminId: OTHER_ID,
    });
    // First call selects the table, second is the SET payload.
    const payload = setArg.mock.calls[1][0] as Record<string, unknown>;
    expect(payload).toEqual({ status: "suspended", updatedAt: expect.any(Date) });
    expect(payload).not.toHaveProperty("role");
    expect(payload).not.toHaveProperty("email");
  });

  it("reuses the same safe projection for the returned row", async () => {
    updateRows = [{ id: USER_ID }];
    await adminUsers.setUserStatus({
      userId: USER_ID,
      status: "active",
      actingAdminId: OTHER_ID,
    });
    const columns = returningArg.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(columns)).not.toContain("authUserId");
    expect(Object.keys(columns)).not.toContain("providerUserId");
  });

  it("reports an unmatched update as not found rather than succeeding", async () => {
    updateRows = [];
    await expect(
      adminUsers.setUserStatus({
        userId: USER_ID,
        status: "suspended",
        actingAdminId: OTHER_ID,
      })
    ).rejects.toThrow(/not found/i);
  });
});
