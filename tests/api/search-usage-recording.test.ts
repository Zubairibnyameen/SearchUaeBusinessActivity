import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import {
  authViewerMock,
  resetAuth,
  signInAsUser,
  signInAsAdmin,
  signInAsSuspended,
} from "../helpers/auth-mock";

/**
 * Search usage recording at the HTTP boundary.
 *
 * The search route is the one place a user-controlled query string becomes a
 * stored row, so the rules worth defending are all about attribution:
 *
 *   - an ACTIVE authenticated search records exactly one row;
 *   - anonymous and suspended callers record nothing at all;
 *   - the account id comes from the verified session, never from the request,
 *     so a `?userId=` in the query string is inert;
 *   - and none of this can change what the caller gets back. Ranking, results,
 *     the public projection and the error paths are asserted to be identical
 *     whether the insert succeeds or explodes.
 */
vi.mock("@/lib/auth/viewer", () => authViewerMock());

const { mockInsert, valuesImpl } = vi.hoisted(() => {
  const valuesImpl = vi.fn();
  return {
    valuesImpl,
    mockInsert: vi.fn<(table: unknown) => { values: typeof valuesImpl }>(
      () => ({ values: valuesImpl })
    ),
  };
});

vi.mock("@/lib/db", () => ({
  db: { insert: mockInsert, select: vi.fn() },
}));

const mockSearchUnified = vi.fn();

vi.mock("@/lib/search/engine", () => ({
  searchUnified: (...args: unknown[]) => mockSearchUnified(...args),
}));

let searchGET: typeof import("@/app/api/activities/search/route").GET;

beforeAll(async () => {
  searchGET = (await import("@/app/api/activities/search/route")).GET;
});

const LAYLA_ID = "11111111-1111-4111-8111-111111111111";

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

/** Rows the usage insert was asked to write. */
function writtenRows(): Array<Record<string, unknown>> {
  return valuesImpl.mock.calls.map(args => args[0] as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  valuesImpl.mockResolvedValue([{ id: "row-1" }]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mockSearchUnified.mockResolvedValue({
    query: "restaurant",
    total: 3,
    results: [{ id: "a1", name: "Cafe", relevance: 0.9 }],
    facets: {},
    suggestions: [],
    jurisdictionGroups: [],
    availability: { indexedJurisdictionSlugs: ["dmcc"], matchedJurisdictionSlugs: [] },
    meta: { tookMs: 3, candidatesEvaluated: 10, minRelevanceThreshold: 0.62 },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. An authenticated active user creates exactly one record
// ─────────────────────────────────────────────────────────────────────────────

describe("authenticated active user search records usage", () => {
  it("writes exactly one row", async () => {
    signInAsUser({ id: LAYLA_ID });
    await searchGET(req("/api/activities/search?q=restaurant"));

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(writtenRows()).toHaveLength(1);
  });

  it("attributes the row to the session's own account id", async () => {
    signInAsUser({ id: LAYLA_ID });
    await searchGET(req("/api/activities/search?q=restaurant"));

    expect(writtenRows()[0]).toEqual({ userId: LAYLA_ID, query: "restaurant" });
  });

  it("records the query the caller actually submitted", async () => {
    signInAsUser({ id: LAYLA_ID });
    await searchGET(req("/api/activities/search?q=trading%20licence"));

    expect(writtenRows()[0].query).toBe("trading licence");
  });

  it("records an admin's search too — admins are ordinary search users", async () => {
    signInAsAdmin({ id: LAYLA_ID });
    await searchGET(req("/api/activities/search?q=restaurant"));

    expect(writtenRows()).toHaveLength(1);
    expect(writtenRows()[0].userId).toBe(LAYLA_ID);
  });

  it("records nothing extra in the response", async () => {
    signInAsUser({ id: LAYLA_ID });
    const res = await searchGET(req("/api/activities/search?q=restaurant"));
    const body = await res.json();

    // Usage is bookkeeping: it must not appear in the payload the browser sees.
    expect(body.usage).toBeUndefined();
    expect(body.total).toBe(3);
  });

  it("keeps the jurisdiction's activityCode (License Number) in the response", async () => {
    signInAsUser({ id: LAYLA_ID });
    mockSearchUnified.mockResolvedValue({
      query: "cafe",
      total: 1,
      results: [
        {
          id: "a1",
          name: "Cafe",
          relevance: 1,
          isicCode: "5629",
          activity: { activityCode: "DMCC-0001", name: "Cafe" },
        },
      ],
      facets: {},
      suggestions: [],
      jurisdictionGroups: [
        {
          jurisdiction: { slug: "dmcc", name: "DMCC" },
          status: "active",
          totalMatches: 1,
          bestMatchType: "name",
          topResults: [
            {
              id: "a1",
              name: "Cafe",
              relevance: 1,
              activity: { activityCode: "DMCC-0001", name: "Cafe" },
            },
          ],
        },
      ],
      availability: { indexedJurisdictionSlugs: [], matchedJurisdictionSlugs: [] },
      meta: { tookMs: 1, candidatesEvaluated: 1, minRelevanceThreshold: 0.62 },
    });

    const res = await searchGET(req("/api/activities/search?q=cafe"));
    const body = await res.json();

    // Recording usage must not have disturbed the public projection: the
    // jurisdiction's own code is now a legal public identifier.
    expect(body.results[0].activity.activityCode).toBe("DMCC-0001");
    expect(body.results[0].activity.name).toBe("Cafe");
    expect(body.jurisdictionGroups[0].topResults[0].activity.activityCode).toBe("DMCC-0001");
    expect(JSON.stringify(body)).toContain("DMCC-0001");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Anonymous search creates no record
// ─────────────────────────────────────────────────────────────────────────────

describe("anonymous search records nothing", () => {
  it("is still rejected with 401", async () => {
    resetAuth();
    const res = await searchGET(req("/api/activities/search?q=restaurant"));
    expect(res.status).toBe(401);
  });

  it("writes no usage row", async () => {
    resetAuth();
    await searchGET(req("/api/activities/search?q=restaurant"));
    expect(mockInsert).not.toHaveBeenCalled();
    expect(writtenRows()).toHaveLength(0);
  });

  it("does not run the search engine either", async () => {
    resetAuth();
    await searchGET(req("/api/activities/search?q=restaurant"));
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it("returns no activity data", async () => {
    resetAuth();
    const res = await searchGET(req("/api/activities/search?q=restaurant"));
    const body = await res.json();
    expect(body.results).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. A suspended user creates no record
// ─────────────────────────────────────────────────────────────────────────────

describe("suspended user search records nothing", () => {
  it("is still rejected with 403", async () => {
    signInAsSuspended({ id: LAYLA_ID });
    const res = await searchGET(req("/api/activities/search?q=restaurant"));
    expect(res.status).toBe(403);
  });

  it("writes no usage row", async () => {
    signInAsSuspended({ id: LAYLA_ID });
    await searchGET(req("/api/activities/search?q=restaurant"));
    expect(writtenRows()).toHaveLength(0);
  });

  it("does not run the search engine", async () => {
    signInAsSuspended({ id: LAYLA_ID });
    await searchGET(req("/api/activities/search?q=restaurant"));
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it("records nothing for a suspended admin either", async () => {
    // Suspension is the stronger gate: the admin role must not bypass it.
    signInAsSuspended({ id: LAYLA_ID, role: "admin" });
    await searchGET(req("/api/activities/search?q=restaurant"));
    expect(writtenRows()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The client cannot provide or override the userId
// ─────────────────────────────────────────────────────────────────────────────

describe("userId cannot come from the request", () => {
  const ATTACKER_ID = "deadbeef-dead-beef-dead-beefdeadbeef";

  it("ignores a userId query parameter", async () => {
    signInAsUser({ id: LAYLA_ID });
    await searchGET(req(`/api/activities/search?q=restaurant&userId=${ATTACKER_ID}`));

    expect(writtenRows()[0].userId).toBe(LAYLA_ID);
    expect(writtenRows()[0].userId).not.toBe(ATTACKER_ID);
  });

  it("ignores an authUserId query parameter", async () => {
    signInAsUser({ id: LAYLA_ID });
    await searchGET(
      req(`/api/activities/search?q=restaurant&authUserId=${ATTACKER_ID}&providerUserId=${ATTACKER_ID}`)
    );

    const serialised = JSON.stringify(writtenRows()[0]);
    expect(serialised).not.toContain(ATTACKER_ID);
  });

  it("writes no id-shaped key beyond userId", async () => {
    signInAsUser({ id: LAYLA_ID });
    await searchGET(req(`/api/activities/search?q=restaurant&userId=${ATTACKER_ID}`));

    expect(Object.keys(writtenRows()[0]).sort()).toEqual(["query", "userId"]);
  });

  it("ignores an email parameter when choosing the account", async () => {
    signInAsUser({ id: LAYLA_ID, email: "layla@example.com" });
    await searchGET(
      req("/api/activities/search?q=restaurant&email=attacker@evil.test")
    );

    expect(writtenRows()[0].userId).toBe(LAYLA_ID);
  });

  it("the route reads the account id from the viewer, not the URL", async () => {
    // Source-level guard: if a future edit reads `searchParams.get("userId")`
    // the tests above would still pass only if the DAL ignored it, so assert
    // the route never even looks for one.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src",
        "app",
        "api",
        "activities",
        "search",
        "route.ts"
      ),
      "utf8"
    );
    expect(source).not.toMatch(/searchParams\.get\(\s*["'](userId|authUserId|providerUserId)["']/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. A usage failure must not break the search
// ─────────────────────────────────────────────────────────────────────────────

describe("usage recording failure does not break the search", () => {
  it("still returns 200", async () => {
    signInAsUser({ id: LAYLA_ID });
    valuesImpl.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const res = await searchGET(req("/api/activities/search?q=restaurant"));
    expect(res.status).toBe(200);
  });

  it("still returns the normal result payload", async () => {
    signInAsUser({ id: LAYLA_ID });
    valuesImpl.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const res = await searchGET(req("/api/activities/search?q=restaurant"));
    const body = await res.json();

    expect(body.total).toBe(3);
    expect(body.results[0].name).toBe("Cafe");
  });

  it("never leaks the database error to the client", async () => {
    signInAsUser({ id: LAYLA_ID });
    valuesImpl.mockRejectedValue(
      new Error('password authentication failed for user "app"')
    );

    const res = await searchGET(req("/api/activities/search?q=restaurant"));
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toMatch(/password authentication/i);
    expect(raw).not.toMatch(/connection terminated/i);
    expect(raw).not.toMatch(/postgres/i);
  });

  it("still ran the search engine exactly once", async () => {
    signInAsUser({ id: LAYLA_ID });
    valuesImpl.mockRejectedValue(new Error("boom"));

    await searchGET(req("/api/activities/search?q=restaurant"));
    expect(mockSearchUnified).toHaveBeenCalledTimes(1);
  });

  it("keeps the private cache header", async () => {
    signInAsUser({ id: LAYLA_ID });
    valuesImpl.mockRejectedValue(new Error("boom"));

    const res = await searchGET(req("/api/activities/search?q=restaurant"));
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("logs the failure server-side", async () => {
    signInAsUser({ id: LAYLA_ID });
    valuesImpl.mockRejectedValue(new Error("boom"));

    await searchGET(req("/api/activities/search?q=restaurant"));
    expect(console.error).toHaveBeenCalled();
  });

  it("does not log the search text itself", async () => {
    signInAsUser({ id: LAYLA_ID });
    valuesImpl.mockRejectedValue(new Error("boom"));

    await searchGET(req("/api/activities/search?q=Acme%20Secret%20Licence"));
    const logged = JSON.stringify(
      (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    );
    expect(logged).not.toContain("Acme Secret Licence");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation failures are not searches
// ─────────────────────────────────────────────────────────────────────────────

describe("rejected requests record no usage", () => {
  it("records nothing when q is missing", async () => {
    signInAsUser({ id: LAYLA_ID });
    const res = await searchGET(req("/api/activities/search"));

    expect(res.status).toBe(400);
    expect(writtenRows()).toHaveLength(0);
  });

  it("records nothing when q is only whitespace", async () => {
    signInAsUser({ id: LAYLA_ID });
    const res = await searchGET(req("/api/activities/search?q=%20%20"));

    expect(res.status).toBe(400);
    expect(writtenRows()).toHaveLength(0);
  });

  it("records nothing when q is over the length cap", async () => {
    signInAsUser({ id: LAYLA_ID });
    const res = await searchGET(
      req(`/api/activities/search?q=${"a".repeat(2001)}`)
    );

    expect(res.status).toBe(400);
    expect(writtenRows()).toHaveLength(0);
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it("records nothing when the search engine itself throws", async () => {
    signInAsUser({ id: LAYLA_ID });
    mockSearchUnified.mockRejectedValue(new Error("engine down"));

    const res = await searchGET(req("/api/activities/search?q=restaurant"));

    expect(res.status).toBe(500);
    // A search that never ran is not a search that happened.
    expect(writtenRows()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The public projection is untouched
// ─────────────────────────────────────────────────────────────────────────────

describe("public search surfaces are unaffected", () => {
  it("the route has no fallback path that records for an anonymous caller", async () => {
    // The usage recorder is only ever called after `requireViewer()` has
    // returned, so there is no branch that could reach it without a session.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src",
        "app",
        "api",
        "activities",
        "search",
        "route.ts"
      ),
      "utf8"
    );

    const gateAt = source.indexOf("requireViewer()");
    const recordAt = source.indexOf("recordSearchUsageSafely(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(gateAt);
  });

  it("counts one row per request, not one per result", async () => {
    signInAsUser({ id: LAYLA_ID });
    await searchGET(req("/api/activities/search?q=restaurant"));
    // Three results came back; usage is one search, not three.
    expect(writtenRows()).toHaveLength(1);
  });

  it("counts paginated requests separately", async () => {
    signInAsUser({ id: LAYLA_ID });
    await searchGET(req("/api/activities/search?q=restaurant&limit=10&offset=0"));
    await searchGET(req("/api/activities/search?q=restaurant&limit=10&offset=10"));

    expect(writtenRows()).toHaveLength(2);
  });
});
