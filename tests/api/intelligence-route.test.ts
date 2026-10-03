import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { authViewerMock, resetAuth, signInAsUser } from "../helpers/auth-mock";

const mockGetJurisdictionIntelligence = vi.fn();
vi.mock("@/lib/auth/viewer", () => authViewerMock());
vi.mock("@/lib/search/jurisdiction-intelligence", () => ({
  getJurisdictionIntelligence: (...args: unknown[]) => mockGetJurisdictionIntelligence(...args),
}));

let GET: typeof import("@/app/api/intelligence/route").GET;

beforeAll(async () => {
  ({ GET } = await import("@/app/api/intelligence/route"));
});

const LEAK_RE = /stack|Error:|SELECT|FROM|WHERE|node_modules|src\//;

beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  signInAsUser();
});

describe("GET /api/intelligence", () => {
  it("returns 400 when q is missing", async () => {
    const res = await GET(new NextRequest("http://localhost/api/intelligence"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("q");
  });

  it("returns 400 when q is whitespace only", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/intelligence?q=+++")
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when q exceeds max length", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/intelligence?q=${"a".repeat(501)}`)
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 with jurisdiction intelligence for valid query", async () => {
    mockGetJurisdictionIntelligence.mockResolvedValue({
      query: "restaurant",
      intent: { primaryNoun: "restaurant", industryDomain: "food", specificityLevel: "broad", isGenericQuery: false },
      jurisdictions: [],
      meta: { tookMs: 5, totalMatched: 0, totalUnmatched: 0, indexedJurisdictions: 0 },
    });
    const res = await GET(
      new NextRequest("http://localhost/api/intelligence?q=restaurant")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("query", "restaurant");
    expect(body).toHaveProperty("jurisdictions");
    expect(body).toHaveProperty("intent");
    expect(body).toHaveProperty("meta");
    expect(mockGetJurisdictionIntelligence).toHaveBeenCalledWith("restaurant");
  });

  it("returns 500 on service failure without leaking internals", async () => {
    mockGetJurisdictionIntelligence.mockRejectedValueOnce(new Error("boom"));
    const res = await GET(
      new NextRequest("http://localhost/api/intelligence?q=restaurant")
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(LEAK_RE);
    expect(body.error).toBeDefined();
  });
});

describe("intelligence output - no fabricated data", () => {
  it("never returns a MATCH jurisdiction without a matched activity", async () => {
    mockGetJurisdictionIntelligence.mockResolvedValue({
      query: "restaurant",
      intent: {},
      jurisdictions: [
        {
          jurisdiction: { id: "j1", name: "DMCC", slug: "dmcc", emirate: "dubai", jurisdictionType: "free_zone" },
          status: "MATCH",
          bestMatch: null,
          matchedActivities: [],
          licenceIntelligence: null,
        },
      ],
      meta: { tookMs: 5, totalMatched: 1, totalUnmatched: 0, indexedJurisdictions: 1 },
    });
    const res = await GET(
      new NextRequest("http://localhost/api/intelligence?q=restaurant")
    );
    const body = await res.json();
    expect(body.jurisdictions[0].status).toBe("MATCH");
    expect(body.jurisdictions[0].matchedActivities).toEqual([]);
    expect(body.jurisdictions[0].licenceIntelligence).toBeNull();
  });
});
