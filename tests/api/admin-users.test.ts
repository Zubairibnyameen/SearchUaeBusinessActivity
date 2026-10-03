import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import {
  authViewerMock,
  authUserStats,
  authUserList,
  EMPTY_USER_STATS,
  resetAuth,
  signInAsUser,
  signInAsAdmin,
  signInAsSuspended,
} from "../helpers/auth-mock";

/**
 * `/api/admin/users` is the privileged surface for user management.
 *
 * The three properties under test are the ones that matter for security:
 *   1. Authorization is decided before any input is read or any query runs, so
 *      a non-admin cannot enumerate users or probe ids.
 *   2. Identity comes from the session only — no parameter can widen scope.
 *   3. Only `status` is writable: no self-promotion, no email rewrite, no
 *      deletion, and no provider identifiers in the payload.
 */

vi.mock("@/lib/auth/viewer", () => authViewerMock());

const getAdminUserById = vi.fn();
const setUserStatus = vi.fn();
vi.mock("@/lib/auth/admin-users", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/admin-users")>(
      "@/lib/auth/admin-users"
    );
  return {
    ...actual,
    getAdminUserById: (...args: unknown[]) => getAdminUserById(...args),
    setUserStatus: (...args: unknown[]) => setUserStatus(...args),
  };
});

type ListRoute = typeof import("@/app/api/admin/users/route");
type UserRoute = typeof import("@/app/api/admin/users/[id]/route");

let listGET: ListRoute["GET"];
let userGET: UserRoute["GET"];
let userPATCH: UserRoute["PATCH"];

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

beforeAll(async () => {
  listGET = (await import("@/app/api/admin/users/route")).GET;
  userGET = (await import("@/app/api/admin/users/[id]/route")).GET;
  userPATCH = (await import("@/app/api/admin/users/[id]/route")).PATCH;
});

function listRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/admin/users${query}`);
}

function userRequest(
  id: string,
  init?: ConstructorParameters<typeof NextRequest>[1]
): NextRequest {
  return new NextRequest(`http://localhost/api/admin/users/${id}`, init);
}

function userParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown): ConstructorParameters<typeof NextRequest>[1] {
  return {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const ADMIN_ROW = {
  id: USER_ID,
  email: "user@example.com",
  fullName: "Test User",
  avatarUrl: null,
  provider: "google",
  role: "user",
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  lastLoginAt: new Date("2026-01-02T00:00:00.000Z"),
};

beforeEach(() => {
  resetAuth();
  vi.clearAllMocks();
  authUserStats.mockResolvedValue({ ...EMPTY_USER_STATS });
  authUserList.mockResolvedValue([]);
  getAdminUserById.mockResolvedValue({ ...ADMIN_ROW });
  setUserStatus.mockResolvedValue({ ...ADMIN_ROW });
});

// ── Authorization ──────────────────────────────────────────────────────────

describe("GET /api/admin/users — authorization", () => {
  it("returns 401 with no session and never queries the database", async () => {
    const res = await listGET(listRequest());
    expect(res.status).toBe(401);
    expect(authUserList).not.toHaveBeenCalled();
    expect(authUserStats).not.toHaveBeenCalled();
  });

  it("returns 403 for a normal user and never queries the database", async () => {
    signInAsUser();
    const res = await listGET(listRequest());
    expect(res.status).toBe(403);
    expect(authUserList).not.toHaveBeenCalled();
  });

  it("returns 403 for a suspended user even if the role says admin", async () => {
    // Suspension must win over role, so a suspended admin is locked out.
    signInAsSuspended({ role: "admin" });
    const res = await listGET(listRequest());
    expect(res.status).toBe(403);
    expect(authUserList).not.toHaveBeenCalled();
  });

  it("returns the list for an active admin", async () => {
    signInAsAdmin();
    authUserList.mockResolvedValue([{ ...ADMIN_ROW }]);
    const res = await listGET(listRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.pagination).toMatchObject({ total: 0, limit: 25, offset: 0 });
  });

  it("marks the response no-store so user data is never cached", async () => {
    signInAsAdmin();
    const res = await listGET(listRequest());
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("does not accept a userId, email or isAdmin query parameter", async () => {
    signInAsAdmin();
    const res = await listGET(
      listRequest("?userId=" + OTHER_ID + "&isAdmin=true&role=admin")
    );
    expect(res.status).toBe(200);

    // The extra parameters must not reach the data layer.
    const args = authUserList.mock.calls[0][0] as Record<string, unknown>;
    expect(args).not.toHaveProperty("userId");
    expect(args).not.toHaveProperty("isAdmin");
  });
});

// ── Input handling ─────────────────────────────────────────────────────────

describe("GET /api/admin/users — input handling", () => {
  beforeEach(() => signInAsAdmin());

  it("caps the page size and never trusts a negative offset", async () => {
    await listGET(listRequest("?limit=100000&offset=-50"));
    const args = authUserList.mock.calls[0][0] as Record<string, number>;
    expect(args.limit).toBe(200);
    expect(args.offset).toBe(0);
  });

  it("drops an unrecognised role or status instead of forwarding it", async () => {
    await listGET(listRequest("?role=superuser&status=deleted"));
    const args = authUserList.mock.calls[0][0] as Record<string, unknown>;
    expect(args.role).toBeUndefined();
    expect(args.status).toBeUndefined();
  });

  it("truncates an oversized search term", async () => {
    await listGET(listRequest(`?q=${"a".repeat(5000)}`));
    const args = authUserList.mock.calls[0][0] as Record<string, string>;
    expect(args.search.length).toBeLessThanOrEqual(200);
  });
});

// ── Single user ────────────────────────────────────────────────────────────

describe("GET /api/admin/users/:id", () => {
  it("returns 401 with no session and does not touch the database", async () => {
    const res = await userGET(userRequest(USER_ID), userParams(USER_ID));
    expect(res.status).toBe(401);
    expect(getAdminUserById).not.toHaveBeenCalled();
  });

  it("returns 403 for a normal user and does not touch the database", async () => {
    signInAsUser();
    const res = await userGET(userRequest(USER_ID), userParams(USER_ID));
    expect(res.status).toBe(403);
    expect(getAdminUserById).not.toHaveBeenCalled();
  });

  it("authorizes before validating the id, so ids cannot be probed", async () => {
    resetAuth();
    const res = await userGET(userRequest("not-a-uuid"), userParams("not-a-uuid"));
    // 401, not 404: an anonymous caller learns nothing about id validity.
    expect(res.status).toBe(401);
  });

  it("passes only the DAL's already-projected user through", async () => {
    // The route must not widen the DAL projection. The guarantee that provider
    // identifiers never reach a client lives in `USER_DETAIL_COLUMNS` and is
    // asserted directly in tests/unit/admin-users.test.ts.
    signInAsAdmin();
    getAdminUserById.mockResolvedValue({ ...ADMIN_ROW });
    const res = await userGET(userRequest(USER_ID), userParams(USER_ID));
    expect(res.status).toBe(200);

    // Dates serialise to ISO strings across the wire.
    expect(await res.json()).toEqual({
      user: {
        ...ADMIN_ROW,
        createdAt: ADMIN_ROW.createdAt.toISOString(),
        updatedAt: ADMIN_ROW.updatedAt.toISOString(),
        lastLoginAt: ADMIN_ROW.lastLoginAt.toISOString(),
      },
    });
  });
});

// ── Status mutation ────────────────────────────────────────────────────────

describe("PATCH /api/admin/users/:id", () => {
  it("returns 401 with no session", async () => {
    const res = await userPATCH(
      userRequest(USER_ID, jsonRequest({ status: "suspended" })),
      userParams(USER_ID)
    );
    expect(res.status).toBe(401);
    expect(setUserStatus).not.toHaveBeenCalled();
  });

  it("returns 403 for a normal user", async () => {
    signInAsUser();
    const res = await userPATCH(
      userRequest(USER_ID, jsonRequest({ status: "suspended" })),
      userParams(USER_ID)
    );
    expect(res.status).toBe(403);
    expect(setUserStatus).not.toHaveBeenCalled();
  });

  it("rejects a role change instead of ignoring it", async () => {
    signInAsAdmin();
    const res = await userPATCH(
      userRequest(USER_ID, jsonRequest({ status: "active", role: "admin" })),
      userParams(USER_ID)
    );
    expect(res.status).toBe(400);
    expect(setUserStatus).not.toHaveBeenCalled();
  });

  it("rejects an email change", async () => {
    signInAsAdmin();
    const res = await userPATCH(
      userRequest(USER_ID, jsonRequest({ status: "active", email: "x@y.z" })),
      userParams(USER_ID)
    );
    expect(res.status).toBe(400);
    expect(setUserStatus).not.toHaveBeenCalled();
  });

  it("rejects a status outside the allowed set", async () => {
    signInAsAdmin();
    for (const status of ["deleted", "banned", "", 1, null]) {
      const res = await userPATCH(
        userRequest(USER_ID, jsonRequest({ status })),
        userParams(USER_ID)
      );
      expect(res.status).toBe(400);
    }
    expect(setUserStatus).not.toHaveBeenCalled();
  });

  it("rejects a malformed or non-object body", async () => {
    signInAsAdmin();
    const bad = await userPATCH(
      userRequest(USER_ID, { method: "PATCH", body: "{oops" }),
      userParams(USER_ID)
    );
    expect(bad.status).toBe(400);

    const arr = await userPATCH(
      userRequest(USER_ID, jsonRequest(["suspended"])),
      userParams(USER_ID)
    );
    expect(arr.status).toBe(400);
  });

  it("records the acting admin so the change is attributable", async () => {
    const admin = signInAsAdmin();
    await userPATCH(
      userRequest(USER_ID, jsonRequest({ status: "suspended" })),
      userParams(USER_ID)
    );
    expect(setUserStatus).toHaveBeenCalledWith({
      userId: USER_ID,
      status: "suspended",
      actingAdminId: admin.id,
    });
  });

  it("reports a missing user as 404", async () => {
    signInAsAdmin();
    const { ForbiddenError } = await import("@/lib/auth/errors");
    setUserStatus.mockRejectedValue(new ForbiddenError("User not found"));
    const res = await userPATCH(
      userRequest(OTHER_ID, jsonRequest({ status: "suspended" })),
      userParams(OTHER_ID)
    );
    expect(res.status).toBe(404);
  });
});
