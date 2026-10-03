import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import {
  authViewerMock,
  resetAuth,
  signInAsUser,
} from "../helpers/auth-mock";

const mockSearchUnified = vi.fn();
const mockGetRegulatorySummaries = vi.fn();

vi.mock("@/lib/auth/viewer", () => authViewerMock());

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));
vi.mock("@/lib/search/engine", () => ({
  searchUnified: (...args: unknown[]) => mockSearchUnified(...args),
}));
vi.mock("@/lib/search/enrichment", () => ({
  getRegulatorySummaries: (...args: unknown[]) => mockGetRegulatorySummaries(...args),
}));

let compareGET: typeof import("@/app/api/compare/route").GET;

beforeAll(async () => {
  ({ GET: compareGET } = await import("@/app/api/compare/route"));
});

const LEAK_RE = /stack|Error:|SELECT|FROM|WHERE|node_modules|src\//;

function jurisdiction(slug: string, name: string) {
  return { id: `jur-${slug}`, name, slug, emirate: "dubai", jurisdictionType: "free_zone" };
}

function group(slug: string, name: string, status: "match" | "no_match", matchType?: string) {
  return {
    jurisdiction: jurisdiction(slug, name),
    status,
    totalMatches: status === "match" ? 1 : 0,
    bestMatchType: matchType ?? null,
    topResults:
      status === "match"
        ? [
            {
              activity: {
                id: `act-${slug}`,
                officialName: "General Trading",
                normalizedName: "general trading",
                activityCode: "GT-01",
                description: null,
                officialCategory: "Trading",
                activityGroup: "Trading",
                approvalSignal: "no_signal",
                approvalStatus: "unknown",
                verificationStatus: "verified",
                lastVerified: "2026-01-01",
              },
              jurisdiction: jurisdiction(slug, name),
              licenceType: { id: "lt", name: "Commercial", code: "COM" },
              matchType,
              matchScore: 1,
              matchReasons: ["exact"],
              source: { id: "s", url: "https://x.com", title: "Source", lastVerified: "2026-01-01" },
            },
          ]
        : [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  signInAsUser();
  // Default: no verified approvals/fees for any activity. Individual tests
  // override this with `mockResolvedValueOnce` when they need real summaries.
  mockGetRegulatorySummaries.mockResolvedValue(new Map());
});


interface SearchCompareRow {
  jurisdiction: { slug: string; name: string };
  status: "MATCH" | "NO_MATCH";
  activity: { officialName: string } | null;
  fees: { governmentFees: unknown[]; displayText: string };
}

interface SearchCompareBody {
  query: string;
  results: SearchCompareRow[];
}

async function readBody(res: Response): Promise<SearchCompareBody> {
  return (await res.json()) as SearchCompareBody;
}

describe("GET /api/compare (search-based mode)", () => {
  it("returns 400 when q is missing", async () => {
    const res = await compareGET(
      new NextRequest("http://localhost/api/compare?jurisdictionSlug=dmcc&jurisdictionSlug=rakez")
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is whitespace only", async () => {
    const res = await compareGET(
      new NextRequest("http://localhost/api/compare?q=+++&jurisdictionSlug=dmcc&jurisdictionSlug=rakez")
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is too long", async () => {
    const res = await compareGET(
      new NextRequest(`http://localhost/api/compare?q=${"a".repeat(501)}&jurisdictionSlug=dmcc&jurisdictionSlug=rakez`)
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when fewer than 2 jurisdiction slugs provided", async () => {
    const res = await compareGET(
      new NextRequest("http://localhost/api/compare?q=restaurant&jurisdictionSlug=dmcc")
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when more than 4 jurisdiction slugs provided", async () => {
    const res = await compareGET(
      new NextRequest(
        "http://localhost/api/compare?q=restaurant&jurisdictionSlug=a&jurisdictionSlug=b&jurisdictionSlug=c&jurisdictionSlug=d&jurisdictionSlug=e"
      )
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 with MATCH and NO_MATCH rows", async () => {
    mockSearchUnified.mockResolvedValue({
      query: "general trading",
      total: 1,
      results: [],
      jurisdictionGroups: [
        group("dmcc", "DMCC", "match", "exact"),
        group("rakez", "RAKEZ", "no_match"),
      ],
      availability: { matchedJurisdictionSlugs: ["dmcc"], unmatched: [jurisdiction("rakez", "RAKEZ")] },
      intent: { primaryNoun: "trading" },
      meta: { tookMs: 5, candidatesEvaluated: 1, minRelevanceThreshold: 0.62 },
    });
    const res = await compareGET(
      new NextRequest(
        "http://localhost/api/compare?q=general+trading&jurisdictionSlug=dmcc&jurisdictionSlug=rakez"
      )
    );
    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body).toHaveProperty("query");
    expect(body.results).toHaveLength(2);
    const dmcc = body.results.find(r => r.jurisdiction.slug === "dmcc")!;
    const rakez = body.results.find(r => r.jurisdiction.slug === "rakez")!;
    expect(dmcc.status).toBe("MATCH");
    expect(dmcc.activity?.officialName).toBe("General Trading");
    expect(rakez.status).toBe("NO_MATCH");
    expect(rakez.activity).toBeNull();
  });

  it("does NOT rank jurisdictions by assumption", async () => {
    mockSearchUnified.mockResolvedValue({
      query: "trading",
      total: 1,
      results: [],
      jurisdictionGroups: [
        group("dmcc", "DMCC", "match", "exact"),
        group("rakez", "RAKEZ", "no_match"),
      ],
      availability: { matchedJurisdictionSlugs: ["dmcc"], unmatched: [jurisdiction("rakez", "RAKEZ")] },
      intent: { primaryNoun: "trading" },
      meta: { tookMs: 5, candidatesEvaluated: 1, minRelevanceThreshold: 0.62 },
    });
    const res = await compareGET(
      new NextRequest(
        "http://localhost/api/compare?q=trading&jurisdictionSlug=dmcc&jurisdictionSlug=rakez"
      )
    );
    const body = await res.json();
    expect(body).not.toHaveProperty("bestJurisdiction");
    expect(body).not.toHaveProperty("recommendation");
  });

  it("shows not verified for fee when no fee records exist", async () => {
    mockSearchUnified.mockResolvedValue({
      query: "trading",
      total: 1,
      results: [],
      jurisdictionGroups: [group("dmcc", "DMCC", "match", "exact")],
      availability: { matchedJurisdictionSlugs: ["dmcc"], unmatched: [] },
      intent: { primaryNoun: "trading" },
      meta: { tookMs: 5, candidatesEvaluated: 1, minRelevanceThreshold: 0.62 },
    });
    const res = await compareGET(
      new NextRequest("http://localhost/api/compare?q=trading&jurisdictionSlug=dmcc&jurisdictionSlug=rakez")
    );
    const body = await readBody(res);
    const dmcc = body.results.find(r => r.jurisdiction.slug === "dmcc")!;
    expect(dmcc.fees.governmentFees).toEqual([]);
    expect(dmcc.fees.displayText).toContain("not verified");
  });

  it("returns 500 on service failure without leaking internals", async () => {
    mockSearchUnified.mockRejectedValueOnce(new Error("db crashed"));
    const res = await compareGET(
      new NextRequest(
        "http://localhost/api/compare?q=trading&jurisdictionSlug=dmcc&jurisdictionSlug=rakez"
      )
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(LEAK_RE);
  });
});
