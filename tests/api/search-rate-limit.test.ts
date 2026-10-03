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
 * Rate limiting on /api/activities/search.
 *
 * The limiter is the existing shared one in `src/lib/rate-limit`, reached through
 * the existing `src/lib/auth/rate-limit` facade — no second system is
 * introduced. The search profile simply carries a larger allowance than the
 * credential profile, because a person refining filters and paging through
 * results is not abusing anything.
 *
 * What these tests pin:
 *
 *   - the limiter IS consulted on the search path (not merely present in the
 *     codebase);
 *   - auth still runs FIRST, so a caller with no allowance is still told 401,
 *     and a suspended one is still told 403;
 *   - a refused request costs no engine work and writes no search_usage row,
 *     because a request that was rejected never happened;
 *   - the key comes from the verified session, so no query parameter can mint a
 *     fresh allowance or spend somebody else's;
 *   - and under the limit, absolutely nothing about the response changes.
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
let rateLimit: typeof import("@/lib/auth/rate-limit");
let checkRateLimitDecision: typeof import("@/lib/auth/rate-limit").checkRateLimitDecision;
let RATE_LIMIT_PROFILES: typeof import("@/lib/auth/rate-limit").RATE_LIMIT_PROFILES;

beforeAll(async () => {
  searchGET = (await import("@/app/api/activities/search/route")).GET;
  rateLimit = await import("@/lib/auth/rate-limit");
  ({ checkRateLimitDecision, RATE_LIMIT_PROFILES } = rateLimit);
});

const LAYLA_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

/**
 * The real profile ceiling, read from the limiter rather than restated in the
 * test. Resolved lazily because the module is imported in `beforeAll`.
 */
function searchMax(): number {
  return RATE_LIMIT_PROFILES.search.maxAttempts;
}

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function searchUrl(extra = ""): string {
  return `/api/activities/search?q=restaurant${extra}`;
}

/** search_usage rows the recorder was asked to write. */
function writtenRows(): Array<Record<string, unknown>> {
  return valuesImpl.mock.calls.map(args => args[0] as Record<string, unknown>);
}

/** Exhaust the search allowance for one account by calling the real limiter. */
function exhaust(key: string): void {
  for (let i = 0; i < searchMax(); i++) {
    checkRateLimitDecision(key, "search");
  }
}

/** The key the route is expected to use for an account. */
function keyFor(id: string): string {
  return `search:user:${id}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  valuesImpl.mockResolvedValue([{ id: "row-1" }]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // The limiter is a module singleton, so its counters persist across tests in
  // this file. Clear the two accounts' allowances to make every test independent
  // of the order they run in.
  rateLimit.clearRateLimitProfile(keyFor(LAYLA_ID), "search");
  rateLimit.clearRateLimitProfile(keyFor(OTHER_ID), "search");
  mockSearchUnified.mockResolvedValue({
    query: "restaurant",
    total: 1,
    results: [{ id: "a1", name: "Cafe", relevance: 0.9 }],
    facets: {},
    suggestions: [],
    jurisdictionGroups: [],
    availability: { indexedJurisdictionSlugs: ["dmcc"], matchedJurisdictionSlugs: [] },
    meta: { tookMs: 3, candidatesEvaluated: 10, minRelevanceThreshold: 0.62 },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The limiter is genuinely on the search path
// ─────────────────────────────────────────────────────────────────────────────

describe("the rate limiter is actually consulted", () => {
  it("a request denied by the shared limiter turns into a 429", async () => {
    // Behavioural proof rather than a spy: the real limiter is given a verdict
    // the route could not have produced itself, and the route honours it.
    vi.spyOn(rateLimit, "checkRateLimitDecision").mockReturnValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 42,
    });

    signInAsUser({ id: LAYLA_ID });
    const res = await searchGET(req(searchUrl()));

    expect(res.status).toBe(429);
    // The mocked window is passed straight through, so the route is reading the
    // limiter's own answer rather than inventing a number.
    expect(res.headers.get("retry-after")).toBe("42");
  });

  it("uses the search profile, not the tiny credential profile", async () => {
    const spy = vi.spyOn(rateLimit, "checkRateLimitDecision");
    signInAsUser({ id: LAYLA_ID });
    await searchGET(req(searchUrl()));
    expect(spy.mock.calls[0]![1]).toBe("search");
    spy.mockRestore();
  });

  it("keys on the verified account, not on anything in the query string", async () => {
    const spy = vi.spyOn(rateLimit, "checkRateLimitDecision");
    signInAsUser({ id: LAYLA_ID });
    await searchGET(
      req("/api/activities/search?q=restaurant&userId=forged&ip=1.2.3.4&key=abc")
    );
    const key = spy.mock.calls[0]![0];
    expect(key).toContain(LAYLA_ID);
    expect(key).not.toContain("forged");
    expect(key).not.toContain("1.2.3.4");
    spy.mockRestore();
  });

  it("does not put the search text into the key", async () => {
    // The key is a Map entry in a long-lived process; a query string would put
    // free-text personal data into it, and give every distinct query a fresh
    // allowance.
    const spy = vi.spyOn(rateLimit, "checkRateLimitDecision");
    signInAsUser({ id: LAYLA_ID });
    await searchGET(req("/api/activities/search?q=Acme%20Secret%20Licence"));
    expect(spy.mock.calls[0]![0]).not.toContain("Acme");
    spy.mockRestore();
  });

  it("a normal search allowance is far larger than the credential allowance", () => {
    // If these were equal, wiring the limiter in would have broken real usage.
    expect(RATE_LIMIT_PROFILES.search.maxAttempts).toBeGreaterThan(
      RATE_LIMIT_PROFILES.sensitive.maxAttempts
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Under the limit: behaviour is byte-for-byte unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe("requests under the limit are unaffected", () => {
  it("returns 200", async () => {
    signInAsUser({ id: LAYLA_ID });
    const res = await searchGET(req(searchUrl()));
    expect(res.status).toBe(200);
  });

  it("still returns the full search payload", async () => {
    signInAsUser({ id: LAYLA_ID });
    const res = await searchGET(req(searchUrl()));
    const body = await res.json();
    expect(body.query).toBe("restaurant");
    expect(body.total).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(body.jurisdictionGroups).toEqual([]);
    expect(body.meta).toBeDefined();
  });

  it("keeps the private cache header", async () => {
    signInAsUser({ id: LAYLA_ID });
    const res = await searchGET(req(searchUrl()));
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("adds no rate-limit headers to a successful response", async () => {
    // The success contract is unchanged: a client must not start depending on a
    // header that a future shared-store limiter might not supply.
    signInAsUser({ id: LAYLA_ID });
    const res = await searchGET(req(searchUrl()));
    expect(res.headers.get("retry-after")).toBeNull();
  });

  it("passes filter and pagination options through untouched", async () => {
    signInAsUser({ id: LAYLA_ID });
    await searchGET(
      req("/api/activities/search?q=trading&emirate=dubai&limit=10&offset=5")
    );
    expect(mockSearchUnified).toHaveBeenCalledWith(
      expect.objectContaining({ q: "trading", emirate: "dubai", limit: 10, offset: 5 })
    );
  });

  it("preserves the ranking result the engine returned", async () => {
    signInAsUser({ id: LAYLA_ID });
    const res = await searchGET(req(searchUrl()));
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ id: "a1", relevance: 0.9 });
  });

  it("still records exactly one search_usage row", async () => {
    signInAsUser({ id: LAYLA_ID });
    await searchGET(req(searchUrl()));
    expect(writtenRows()).toEqual([{ userId: LAYLA_ID, query: "restaurant" }]);
  });

  it("still returns 400 for a missing query, without running the engine", async () => {
    signInAsUser({ id: LAYLA_ID });
    const res = await searchGET(req("/api/activities/search"));
    expect(res.status).toBe(400);
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it("still returns 500 when the engine fails", async () => {
    signInAsUser({ id: LAYLA_ID });
    mockSearchUnified.mockRejectedValue(new Error("engine down"));
    const res = await searchGET(req(searchUrl()));
    expect(res.status).toBe(500);
  });

  it("allows an admin to search like any other user", async () => {
    signInAsAdmin({ id: LAYLA_ID });
    const res = await searchGET(req(searchUrl()));
    expect(res.status).toBe(200);
  });

  it("tolerates an interactive session's worth of requests", async () => {
    signInAsUser({ id: LAYLA_ID });
    // 25 searches — typing, refining and paging — must not trip the limiter.
    for (let i = 0; i < 25; i++) {
      const res = await searchGET(req(searchUrl(`&offset=${i * 20}`)));
      expect(res.status).toBe(200);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Over the limit
// ─────────────────────────────────────────────────────────────────────────────

describe("requests over the limit return 429", () => {
  it("allows exactly the allowance, then refuses", async () => {
    signInAsUser({ id: LAYLA_ID });

    const statuses: number[] = [];
    for (let i = 0; i < searchMax(); i++) {
      statuses.push((await searchGET(req(searchUrl()))).status);
    }
    const limited = await searchGET(req(searchUrl()));

    expect(statuses.every(s => s === 200)).toBe(true);
    expect(statuses).toHaveLength(searchMax());
    expect(limited.status).toBe(429);
  });

  it("returns a JSON error body with a stable code", async () => {
    signInAsUser({ id: LAYLA_ID });
    exhaust(keyFor(LAYLA_ID));

    const res = await searchGET(req(searchUrl()));
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.error).toMatch(/too many requests/i);
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("includes Retry-After so a well-behaved client knows when to return", async () => {
    signInAsUser({ id: LAYLA_ID });
    exhaust(keyFor(LAYLA_ID));

    const res = await searchGET(req(searchUrl()));
    const header = res.headers.get("retry-after");
    expect(header).not.toBeNull();
    const seconds = Number(header);
    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(RATE_LIMIT_PROFILES.search.windowMs / 1000);
  });

  it("leaks nothing about the limiter, the key, or the caller", async () => {
    signInAsUser({ id: LAYLA_ID, email: "layla@example.com" });
    exhaust(keyFor(LAYLA_ID));

    const res = await searchGET(req(searchUrl()));
    const serialized = JSON.stringify({
      body: await res.json(),
      headers: [...res.headers.entries()],
    });

    expect(serialized).not.toContain(LAYLA_ID);
    expect(serialized).not.toContain("layla@example.com");
    expect(serialized).not.toContain("memory");
    expect(serialized).not.toContain("search:user");
    expect(serialized).not.toContain("Map");
  });

  it("marks the 429 as uncacheable, like every other search response", async () => {
    signInAsUser({ id: LAYLA_ID });
    exhaust(keyFor(LAYLA_ID));
    const res = await searchGET(req(searchUrl()));
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("returns no result data at all", async () => {
    signInAsUser({ id: LAYLA_ID });
    exhaust(keyFor(LAYLA_ID));
    const body = await (await searchGET(req(searchUrl()))).json();
    expect(body.results).toBeUndefined();
    expect(body.total).toBeUndefined();
    expect(body.jurisdictionGroups).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. A refused request costs nothing
// ─────────────────────────────────────────────────────────────────────────────

describe("a rate-limited request does no expensive work", () => {
  it("does not run the search engine", async () => {
    signInAsUser({ id: LAYLA_ID });
    exhaust(keyFor(LAYLA_ID));

    await searchGET(req(searchUrl()));
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it("does not create a search_usage record", async () => {
    signInAsUser({ id: LAYLA_ID });
    exhaust(keyFor(LAYLA_ID));

    await searchGET(req(searchUrl()));
    expect(writtenRows()).toHaveLength(0);
  });

  it("does not accumulate records across many refused requests", async () => {
    signInAsUser({ id: LAYLA_ID });
    exhaust(keyFor(LAYLA_ID));

    for (let i = 0; i < 10; i++) await searchGET(req(searchUrl()));
    expect(writtenRows()).toHaveLength(0);
  });

  it("recovers once the window passes — a 429 is a throttle, not a ban", async () => {
    // A short window is used so this does not sleep for the real one minute.
    const { MemoryRateLimiter } = await import("@/lib/rate-limit/memory");
    const limiter = new MemoryRateLimiter({ windowMs: 50, maxAttempts: 2 });

    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);

    const refused = limiter.check("k");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);

    await new Promise(resolve => setTimeout(resolve, 60));
    expect(limiter.check("k").allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The allowance cannot be bypassed or stolen
// ─────────────────────────────────────────────────────────────────────────────

describe("the allowance cannot be side-stepped", () => {
  it("varying query text does not grant a new allowance", async () => {
    signInAsUser({ id: LAYLA_ID });
    exhaust(keyFor(LAYLA_ID));

    // A different query, extra params, a different ordering — same key, so the
    // limiter cannot be evaded by mutating the URL.
    const res = await searchGET(
      req("/api/activities/search?q=zzzz&limit=100&verifiedOnly=true&userId=" + OTHER_ID)
    );
    expect(res.status).toBe(429);
  });

  it("a forged userId parameter cannot spend another account's allowance", async () => {
    signInAsUser({ id: LAYLA_ID });

    for (let i = 0; i < searchMax(); i++) {
      await searchGET(req(searchUrl(`&userId=${OTHER_ID}`)));
    }
    // OTHER_ID was named on every request, yet its own budget is untouched.
    expect(checkRateLimitDecision(keyFor(OTHER_ID), "search").remaining).toBe(
      RATE_LIMIT_PROFILES.search.maxAttempts - 1
    );
  });

  it("one account's exhaustion does not limit another account", async () => {
    signInAsUser({ id: LAYLA_ID });
    exhaust(keyFor(LAYLA_ID));
    expect((await searchGET(req(searchUrl()))).status).toBe(429);

    resetAuth();
    signInAsUser({ id: OTHER_ID });
    expect((await searchGET(req(searchUrl()))).status).toBe(200);
  });

  it("the limit is per account, not global", async () => {
    // Guards against a regression that keyed on something shared (a single
    // bucket) and would then throttle one tenant for everybody else's traffic.
    for (let i = 0; i < searchMax(); i++) {
      checkRateLimitDecision(keyFor(LAYLA_ID), "search");
      checkRateLimitDecision(keyFor(OTHER_ID), "search");
    }
    expect(checkRateLimitDecision(keyFor(OTHER_ID), "search").allowed).toBe(false);
    expect(checkRateLimitDecision(`search:user:${OTHER_ID}x`, "search").allowed).toBe(
      true
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Auth rules are unchanged and still come first
// ─────────────────────────────────────────────────────────────────────────────

describe("auth still governs, ahead of the limiter", () => {
  it("an anonymous caller gets 401, not 429, even after heavy traffic", async () => {
    resetAuth();
    for (let i = 0; i < searchMax() + 10; i++) {
      const res = await searchGET(req(searchUrl()));
      expect(res.status).toBe(401);
    }
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it("a suspended user gets 403, not 429", async () => {
    signInAsSuspended({ id: LAYLA_ID });
    for (let i = 0; i < searchMax() + 10; i++) {
      const res = await searchGET(req(searchUrl()));
      expect(res.status).toBe(403);
    }
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it("a suspended admin is still 403", async () => {
    signInAsSuspended({ id: LAYLA_ID, role: "admin" });
    expect((await searchGET(req(searchUrl()))).status).toBe(403);
  });

  it("a rejected caller does not consume a real account's allowance", async () => {
    // Auth runs first, so an unauthenticated flood never touches the counter of
    // the account whose key it might otherwise be guessing.
    resetAuth();
    for (let i = 0; i < searchMax() + 5; i++) await searchGET(req(searchUrl()));

    signInAsUser({ id: LAYLA_ID });
    expect((await searchGET(req(searchUrl()))).status).toBe(200);
  });

  it("a suspended caller records no usage either", async () => {
    signInAsSuspended({ id: LAYLA_ID });
    await searchGET(req(searchUrl()));
    expect(writtenRows()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Structure
// ─────────────────────────────────────────────────────────────────────────────

describe("integration shape", () => {
  it("checks the limit before the engine and before usage recording", async () => {
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
    const limitAt = source.indexOf("checkRateLimitDecision(");
    const engineAt = source.indexOf("searchUnified(options)");
    const recordAt = source.indexOf("recordSearchUsageSafely(viewer, q)");

    expect(gateAt).toBeGreaterThan(-1);
    expect(limitAt).toBeGreaterThan(gateAt);
    expect(engineAt).toBeGreaterThan(limitAt);
    expect(recordAt).toBeGreaterThan(limitAt);
  });

  it("reuses the existing limiter rather than adding a new system", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const routeSource = fs.readFileSync(
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

    // The route must go through the shared facade, and must not reach into a
    // limiter implementation (or build a counter of its own) directly.
    expect(routeSource).toContain('from "@/lib/auth/rate-limit"');
    expect(routeSource).not.toContain("@/lib/rate-limit/memory");
    expect(routeSource).not.toContain("new Map(");
  });

  it("the limiter module still exports the original boolean helper", async () => {
    const mod = await import("@/lib/auth/rate-limit");
    expect(typeof mod.checkRateLimit).toBe("function");
    expect(typeof mod.clearRateLimit).toBe("function");
  });

  it("the credential profile is unchanged by this work", async () => {
    // The `sensitive` defaults were 5 attempts per 10 minutes. Reusing the
    // limiter must not have retuned the endpoint it was built for.
    expect(RATE_LIMIT_PROFILES.sensitive.maxAttempts).toBe(5);
    expect(RATE_LIMIT_PROFILES.sensitive.windowMs).toBe(10 * 60 * 1000);
  });
});