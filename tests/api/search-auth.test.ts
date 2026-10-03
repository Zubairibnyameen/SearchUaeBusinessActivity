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
 * Search, comparison and jurisdiction intelligence all sit behind the same
 * `requireViewer()` gate. These tests assert the gate itself, independently of
 * any other suite, because "is search actually protected" is the single most
 * important question in this change.
 *
 * The rule being pinned:
 *   - no session           -> 401, and the engine is never called
 *   - session, suspended   -> 403, and the engine is never called
 *   - session, active      -> the request proceeds
 *
 * The third case matters as much as the first two: a suspended user's query must
 * be rejected *before* ranking work happens, so it cannot be used to burn compute
 * or to read data through a side channel.
 */

vi.mock("@/lib/auth/viewer", () => authViewerMock());

const mockSearchUnified = vi.fn();
const mockGetJurisdictionIntelligence = vi.fn();
const mockGetRegulatorySummaries = vi.fn();

vi.mock("@/lib/search/engine", () => ({
  searchUnified: (...args: unknown[]) => mockSearchUnified(...args),
}));
vi.mock("@/lib/search/jurisdiction-intelligence", () => ({
  getJurisdictionIntelligence: (...args: unknown[]) =>
    mockGetJurisdictionIntelligence(...args),
}));
vi.mock("@/lib/search/enrichment", () => ({
  getRegulatorySummaries: (...args: unknown[]) => mockGetRegulatorySummaries(...args),
}));
// `insert` is included so the search-usage recorder runs to completion. Leaving
// it out would make the recorder's catch swallow a TypeError, and these
// authorization tests would pass regardless of what the recorder did.
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(() => ({ values: vi.fn() })) },
}));

let searchGET: typeof import("@/app/api/activities/search/route").GET;
let compareGET: typeof import("@/app/api/compare/route").GET;
let intelligenceGET: typeof import("@/app/api/intelligence/route").GET;

beforeAll(async () => {
  searchGET = (await import("@/app/api/activities/search/route")).GET;
  compareGET = (await import("@/app/api/compare/route")).GET;
  intelligenceGET = (await import("@/app/api/intelligence/route")).GET;
});

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

const SEARCH_URL = "/api/activities/search?q=restaurant";
const COMPARE_URL = "/api/compare?q=restaurant&jurisdictionSlug=dmcc&jurisdictionSlug=ifza";
const INTELLIGENCE_URL = "/api/intelligence?q=restaurant";

beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  mockSearchUnified.mockResolvedValue({
    query: "restaurant",
    totalResults: 0,
    results: [],
    facets: {},
    suggestions: [],
    jurisdictionGroups: [],
    // The compare route reads `meta.tookMs` unconditionally, so the shape has
    // to be complete even when there are no matches.
    meta: {
      tookMs: 1,
      candidatesEvaluated: 0,
      minRelevanceThreshold: 0.62,
    },
  });
  mockGetJurisdictionIntelligence.mockResolvedValue({ jurisdictions: [] });
  mockGetRegulatorySummaries.mockResolvedValue({});
});

// ── Unauthenticated ────────────────────────────────────────────────────────

describe("search endpoints reject anonymous callers", () => {
  it("GET /api/activities/search returns 401", async () => {
    const res = await searchGET(req(SEARCH_URL));
    expect(res.status).toBe(401);
  });

  it("GET /api/compare returns 401", async () => {
    const res = await compareGET(req(COMPARE_URL));
    expect(res.status).toBe(401);
  });

  it("GET /api/intelligence returns 401", async () => {
    const res = await intelligenceGET(req(INTELLIGENCE_URL));
    expect(res.status).toBe(401);
  });

  it("does not run the search engine for an anonymous caller", async () => {
    await searchGET(req(SEARCH_URL));
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it("does not run enrichment for an anonymous caller", async () => {
    await compareGET(req(COMPARE_URL));
    expect(mockGetRegulatorySummaries).not.toHaveBeenCalled();
  });

  it("does not return activity data to an anonymous caller", async () => {
    const res = await searchGET(req(SEARCH_URL));
    const body = await res.json();
    expect(body.results).toBeUndefined();
    expect(body.jurisdictions).toBeUndefined();
  });
});

// ── Suspended ──────────────────────────────────────────────────────────────

describe("search endpoints reject suspended users", () => {
  it("GET /api/activities/search returns 403", async () => {
    signInAsSuspended();
    const res = await searchGET(req(SEARCH_URL));
    expect(res.status).toBe(403);
  });

  it("GET /api/compare returns 403", async () => {
    signInAsSuspended();
    const res = await compareGET(req(COMPARE_URL));
    expect(res.status).toBe(403);
  });

  it("GET /api/intelligence returns 403", async () => {
    signInAsSuspended();
    const res = await intelligenceGET(req(INTELLIGENCE_URL));
    expect(res.status).toBe(403);
  });

  it("rejects before ranking, so a suspended user cannot run searches", async () => {
    signInAsSuspended();
    await searchGET(req(SEARCH_URL));
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it("rejects a suspended user even if they are also an admin", async () => {
    // Suspension is the more powerful of the two: it must not be bypassed by
    // holding the admin role.
    signInAsSuspended({ role: "admin" });
    const res = await searchGET(req(SEARCH_URL));
    expect(res.status).toBe(403);
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });
});

// ── Authorised ─────────────────────────────────────────────────────────────

describe("search endpoints admit active sessions", () => {
  it("GET /api/activities/search succeeds for a normal user", async () => {
    signInAsUser();
    const res = await searchGET(req(SEARCH_URL));
    expect(res.status).toBe(200);
    expect(mockSearchUnified).toHaveBeenCalledTimes(1);
  });

  it("GET /api/compare succeeds for a normal user", async () => {
    signInAsUser();
    const res = await compareGET(req(COMPARE_URL));
    expect(res.status).toBe(200);
  });

  it("GET /api/intelligence succeeds for a normal user", async () => {
    signInAsUser();
    const res = await intelligenceGET(req(INTELLIGENCE_URL));
    expect(res.status).toBe(200);
  });

  it("an admin is also an ordinary search user", async () => {
    signInAsAdmin();
    const res = await searchGET(req(SEARCH_URL));
    expect(res.status).toBe(200);
  });

  it("search responses are marked private so per-user data is not cached", async () => {
    signInAsUser();
    const res = await searchGET(req(SEARCH_URL));
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

// ── Public surfaces stay public ────────────────────────────────────────────

describe("public surfaces remain reachable without a session", () => {
  it("the public activity detail route carries no viewer gate", async () => {
    // The sharing feature depends on this: `/activities/:id` and
    // `/api/activities/:id` must stay publicly reachable. Asserting it at the
    // source level is blunt but it fails loudly if a gate is ever added by
    // accident, which would silently break every shared link.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.join(
      process.cwd(),
      "src",
      "app",
      "api",
      "activities",
      "[id]",
      "route.ts"
    );
    const source = fs.readFileSync(file, "utf8");
    expect(source).not.toContain("requireViewer");
    expect(source).not.toContain("requireAdmin");
  });

  it("the public activity detail page carries no viewer gate", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.join(
      process.cwd(),
      "src",
      "app",
      "(public)",
      "activities",
      "[id]",
      "page.tsx"
    );
    const source = fs.readFileSync(file, "utf8");
    expect(source).not.toContain("requireViewer");
    expect(source).not.toContain("requireAdmin");
  });
});
