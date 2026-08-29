import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BusinessIntent } from "@/lib/search/types";

// ─── Mock db ──────────────────────────────────────────────────────────────────
// vi.mock is hoisted above all imports. Use vi.hoisted() so the variable is
// accessible inside the factory.

const { dbMock } = vi.hoisted(() => ({
  dbMock: { select: vi.fn(), selectDistinct: vi.fn(), execute: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

interface CandidateOverrides {
  id?: string;
  officialName?: string;
  normalizedName?: string;
  activityCode?: string | null;
  description?: string | null;
  officialCategory?: string | null;
  activityGroup?: string | null;
  approvalSignal?: "no_signal" | "third_party_approval_indicated" | "may_be_required" | "restricted" | "unknown";
  approvalStatus?: string;
  verificationStatus?: string;
  emirate?: string;
  jurisdictionType?: string;
  jurisdictionId?: string;
  jurisdictionName?: string;
  jurisdictionSlug?: string;
  licenceTypeName?: string | null;
}

function makeCandidate(overrides: CandidateOverrides = {}) {
  const jId = overrides.jurisdictionId ?? "jur-1";
  return {
    activity: {
      id: overrides.id ?? "act-1",
      officialName: overrides.officialName ?? "General Trading",
      normalizedName: overrides.normalizedName ?? "general trading",
      activityCode: overrides.activityCode ?? null,
      description: overrides.description ?? null,
      officialCategory: overrides.officialCategory ?? "Trading",
      activityGroup: overrides.activityGroup ?? "General",
      jurisdictionId: jId,
      licenceTypeId: null,
      approvalSignal: overrides.approvalSignal ?? ("no_signal" as const),
      approvalStatus: overrides.approvalStatus ?? "unknown",
      verificationStatus: overrides.verificationStatus ?? "unverified",
      lastVerified: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    jurisdiction: {
      id: jId,
      name: overrides.jurisdictionName ?? "DMCC",
      slug: overrides.jurisdictionSlug ?? "dmcc",
      emirate: overrides.emirate ?? ("dubai" as const),
      jurisdictionType: overrides.jurisdictionType ?? ("free_zone" as const),
      authorityId: null,
      officialWebsite: null,
      officialActivityUrl: null,
      description: null,
      status: "active" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    licenceType: overrides.licenceTypeName
      ? { id: "lt-1", name: overrides.licenceTypeName, code: "LT01" }
      : null,
    source: null,
  };
}

function makeJurisdictionRow(
  overrides: Partial<{ id: string; slug: string; name: string; emirate: string; jurisdictionType: string }> = {},
) {
  return {
    id: overrides.id ?? "jur-1",
    slug: overrides.slug ?? "dmcc",
    name: overrides.name ?? "DMCC",
    emirate: overrides.emirate ?? "dubai",
    jurisdictionType: overrides.jurisdictionType ?? "free_zone",
  };
}

/**
 * Wire up dbMock so that:
 * - execute() returns the candidate rows flattened to the exact alias shape
 *   the engine's single UNION ALL query produces (STEP 6.1 retrieval collapse),
 *   with the availability-branch rows (a_* NULL, j_* set) appended.
 *
 * Pass candidateRows = [] to test "no results" paths.
 */
function toFlatCandidate(c: any) {
  return {
    a_id: c.activity.id,
    a_official_name: c.activity.officialName,
    a_normalized_name: c.activity.normalizedName,
    a_activity_code: c.activity.activityCode,
    a_description: c.activity.description,
    a_official_category: c.activity.officialCategory,
    a_activity_group: c.activity.activityGroup,
    a_approval_signal: c.activity.approvalSignal,
    a_approval_status: c.activity.approvalStatus,
    a_verification_status: c.activity.verificationStatus,
    a_last_verified: c.activity.lastVerified,
    j_id: c.jurisdiction.id,
    j_name: c.jurisdiction.name,
    j_slug: c.jurisdiction.slug,
    j_emirate: c.jurisdiction.emirate,
    j_jurisdiction_type: c.jurisdiction.jurisdictionType,
    lt_id: c.licenceType?.id,
    lt_name: c.licenceType?.name,
    lt_code: c.licenceType?.code,
    s_id: c.source?.id,
    s_url: c.source?.url,
    s_title: c.source?.title,
    s_last_verified: c.source?.lastVerified,
  };
}

/** Flat availability-branch rows (a_* NULL, j_* populated), as the engine's UNION returns. */
function toFlatAvailabilityRow(j: any) {
  return {
    a_id: null, a_official_name: null, a_normalized_name: null, a_activity_code: null, a_description: null,
    a_official_category: null, a_activity_group: null, a_approval_signal: null, a_approval_status: null,
    a_verification_status: null, a_last_verified: null,
    j_id: j.id,
    j_name: j.name,
    j_slug: j.slug,
    j_emirate: j.emirate,
    j_jurisdiction_type: j.jurisdictionType,
    lt_id: null, lt_name: null, lt_code: null,
    s_id: null, s_url: null, s_title: null, s_last_verified: null,
  };
}

function setupDbMock(
  candidateRows: unknown[],
  jurisdictionRows?: unknown[],
) {
  dbMock.execute.mockReset();
  const jRows = jurisdictionRows ?? [makeJurisdictionRow()];
  dbMock.execute.mockImplementation(() =>
    Promise.resolve([
      ...(candidateRows as any[]).map(toFlatCandidate),
      ...jRows.map(toFlatAvailabilityRow),
    ]));
}

// ─── Import AFTER mock is set up ──────────────────────────────────────────────
import { search, searchUnified, generateAISuggestions } from "@/lib/search/engine";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("search engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // Response shape
  // ========================================================================
  describe("response shape", () => {
    it("searchUnified returns correct top-level keys", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res).toHaveProperty("query");
      expect(res).toHaveProperty("total");
      expect(res).toHaveProperty("results");
      expect(res).toHaveProperty("jurisdictionGroups");
      expect(res).toHaveProperty("availability");
      expect(res).toHaveProperty("intent");
      expect(res).toHaveProperty("meta");
      expect(res.query).toBe("restaurant");
      expect(Array.isArray(res.results)).toBe(true);
      expect(Array.isArray(res.jurisdictionGroups)).toBe(true);
      expect(res.meta).toHaveProperty("tookMs");
      expect(res.meta).toHaveProperty("candidatesEvaluated");
      expect(res.meta).toHaveProperty("minRelevanceThreshold");
    });

    it("search returns flat array", async () => {
      setupDbMock([]);
      const res = await search({ q: "restaurant" });
      expect(Array.isArray(res)).toBe(true);
    });
  });

  // ========================================================================
  // Empty / short queries
  // ========================================================================
  describe("empty and short queries", () => {
    it("returns empty for stop-word-only query", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "a" });
      expect(res.total).toBe(0);
      expect(res.results).toHaveLength(0);
    });

    it("returns empty for whitespace-only query", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "   " });
      expect(res.total).toBe(0);
    });
  });

  // ========================================================================
  // Impossible / negative queries
  // ========================================================================
  describe("impossible queries", () => {
    it("returns 0 results for 'nuclear power plant'", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "nuclear power plant" });
      expect(res.total).toBe(0);
      expect(res.results).toHaveLength(0);
      expect(res.intent.industryDomain).toBe("impossible");
    });

    it("returns 0 results for 'space tourism'", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "space tourism" });
      expect(res.total).toBe(0);
      expect(res.results).toHaveLength(0);
      expect(res.intent.industryDomain).toBe("impossible");
    });
  });

  // ========================================================================
  // Intent detection via response
  // ========================================================================
  describe("intent detection", () => {
    it("detects medical clinic intent", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "medical clinic" });
      expect(res.intent.primaryNoun).toBe("clinic");
      expect(res.intent.industryDomain).toBe("healthcare");
    });

    it("detects dental clinic intent", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "dental clinic" });
      expect(res.intent.primaryNoun).toBe("dental");
      expect(res.intent.industryDomain).toBe("healthcare");
    });

    it("detects digital marketing intent", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "digital marketing agency" });
      expect(res.intent.primaryNoun).toBe("marketing");
      expect(res.intent.industryDomain).toBe("media");
    });

    it("detects software development intent", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "software development company" });
      expect(res.intent.primaryNoun).toBe("software");
      expect(res.intent.industryDomain).toBe("technology");
    });

    it("detects real estate brokerage intent", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "real estate brokerage" });
      expect(res.intent.primaryNoun).toBe("brokerage");
      expect(res.intent.industryDomain).toBe("real estate");
    });

    it("detects logistics intent", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "logistics company" });
      expect(res.intent.primaryNoun).toBe("logistics");
      expect(res.intent.industryDomain).toBe("logistics");
    });

    it("detects jewellery trading intent", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "jewellery trading" });
      expect(res.intent.primaryNoun).toBe("jewellery");
      expect(res.intent.industryDomain).toBe("precious metals");
    });

    it("detects food business intent", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "food business" });
      expect(res.intent.primaryNoun).toBe("food");
      expect(res.intent.industryDomain).toBe("food");
    });

    it("detects security company intent", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "security company" });
      expect(res.intent.primaryNoun).toBe("security");
      expect(res.intent.industryDomain).toBe("security");
    });

    it("detects web development intent", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "web development agency" });
      expect(res.intent.primaryNoun).toBe("web");
      expect(res.intent.industryDomain).toBe("technology");
    });

    it("detects accounting intent", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "accounting" });
      expect(res.intent.primaryNoun).toBe("accounting");
      expect(res.intent.isGenericQuery).toBe(false);
    });

    it("marks generic single-word 'trading' as generic", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "trading" });
      expect(res.intent.isGenericQuery).toBe(true);
    });

    it("marks generic single-word 'consultancy' as generic", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "consultancy" });
      expect(res.intent.isGenericQuery).toBe(true);
    });
  });

  // ========================================================================
  // Exact matches (Level 1)
  // ========================================================================
  describe("exact matches", () => {
    it("finds 'restaurant' with exact match score 1.0", async () => {
      const candidate = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const top = res.results[0];
      expect(top.matchType).toBe("exact");
      expect(top.matchScore).toBe(1.0);
    });

    it("finds 'jewellery trading' with exact match", async () => {
      const candidate = makeCandidate({
        officialName: "Jewellery Trading",
        normalizedName: "jewellery trading",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "jewellery trading" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const top = res.results[0];
      expect(top.matchType).toBe("exact");
      expect(top.matchScore).toBe(1.0);
    });

    it("finds 'general trading' with exact match", async () => {
      const candidate = makeCandidate({
        officialName: "General Trading",
        normalizedName: "general trading",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "general trading" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const top = res.results[0];
      expect(top.matchType).toBe("exact");
      expect(top.matchScore).toBe(1.0);
    });

    it("finds 'accounting' with exact match", async () => {
      const candidate = makeCandidate({
        officialName: "Accounting",
        normalizedName: "accounting",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "accounting" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const top = res.results[0];
      expect(top.matchType).toBe("exact");
      expect(top.matchScore).toBe(1.0);
    });
  });

  // ========================================================================
  // Business intent matches (Level 3+)
  // ========================================================================
  describe("business intent matches", () => {
    it("finds 'medical clinic' with strong match", async () => {
      const candidate = makeCandidate({
        officialName: "Medical Clinic",
        normalizedName: "medical clinic",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "medical clinic" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const match = res.results.find((r) => r.activity.officialName === "Medical Clinic");
      expect(match).toBeDefined();
      expect(["exact", "strong"]).toContain(match!.matchType);
      expect(match!.matchScore).toBeGreaterThanOrEqual(0.92);
    });

    it("finds 'dental clinic' with strong match", async () => {
      const candidate = makeCandidate({
        officialName: "Dental Clinic",
        normalizedName: "dental clinic",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "dental clinic" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const match = res.results.find((r) => r.activity.officialName === "Dental Clinic");
      expect(match).toBeDefined();
      expect(["exact", "strong"]).toContain(match!.matchType);
    });

    it("finds 'digital marketing agency' with strong match", async () => {
      const candidate = makeCandidate({
        officialName: "Digital Marketing Agency",
        normalizedName: "digital marketing agency",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "digital marketing agency" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const match = res.results.find((r) => r.activity.officialName === "Digital Marketing Agency");
      expect(match).toBeDefined();
      expect(["exact", "strong"]).toContain(match!.matchType);
    });

    it("finds 'software development company' with strong match", async () => {
      const candidate = makeCandidate({
        officialName: "Software Development Company",
        normalizedName: "software development company",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "software development company" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const match = res.results.find((r) => r.activity.officialName === "Software Development Company");
      expect(match).toBeDefined();
      expect(["exact", "strong"]).toContain(match!.matchType);
    });

    it("finds 'real estate brokerage' with strong match", async () => {
      const candidate = makeCandidate({
        officialName: "Real Estate Brokerage",
        normalizedName: "real estate brokerage",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "real estate brokerage" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const match = res.results.find((r) => r.activity.officialName === "Real Estate Brokerage");
      expect(match).toBeDefined();
      expect(["exact", "strong"]).toContain(match!.matchType);
    });

    it("finds 'logistics company' with strong match", async () => {
      const candidate = makeCandidate({
        officialName: "Logistics Company",
        normalizedName: "logistics company",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "logistics company" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const match = res.results.find((r) => r.activity.officialName === "Logistics Company");
      expect(match).toBeDefined();
      expect(["exact", "strong"]).toContain(match!.matchType);
    });

    it("finds 'web development agency' with strong match", async () => {
      const candidate = makeCandidate({
        officialName: "Web Development Agency",
        normalizedName: "web development agency",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "web development agency" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const match = res.results.find((r) => r.activity.officialName === "Web Development Agency");
      expect(match).toBeDefined();
      expect(["exact", "strong"]).toContain(match!.matchType);
    });

    it("finds 'accounting consultancy' with strong match", async () => {
      const candidate = makeCandidate({
        officialName: "Accounting Consultancy",
        normalizedName: "accounting consultancy",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "accounting consultancy" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const match = res.results.find((r) => r.activity.officialName === "Accounting Consultancy");
      expect(match).toBeDefined();
      expect(["exact", "strong"]).toContain(match!.matchType);
    });
  });

  // ========================================================================
  // Tricky queries
  // ========================================================================
  describe("tricky queries", () => {
    it("finds 'petrol station'", async () => {
      const candidate = makeCandidate({
        officialName: "Petrol Station",
        normalizedName: "petrol station",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "petrol station" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].matchScore).toBeGreaterThanOrEqual(0.62);
    });

    it("finds 'food business'", async () => {
      const candidate = makeCandidate({
        officialName: "Food Trading",
        normalizedName: "food trading",
        officialCategory: "Food",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "food business" });
      expect(res.total).toBeGreaterThanOrEqual(1);
    });

    it("finds 'fashion brand'", async () => {
      const candidate = makeCandidate({
        officialName: "Fashion Clothing",
        normalizedName: "fashion clothing",
        officialCategory: "Retail",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "fashion brand" });
      expect(res.total).toBeGreaterThanOrEqual(1);
    });

    it("finds 'online electronics store'", async () => {
      const candidate = makeCandidate({
        officialName: "Online Electronics Trading",
        normalizedName: "online electronics trading",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "online electronics store" });
      expect(res.total).toBeGreaterThanOrEqual(1);
    });

    it("finds 'education training'", async () => {
      const candidate = makeCandidate({
        officialName: "Education Training Academy",
        normalizedName: "education training academy",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "education training" });
      expect(res.total).toBeGreaterThanOrEqual(1);
    });

    it("finds 'security company'", async () => {
      const candidate = makeCandidate({
        officialName: "Security Services",
        normalizedName: "security services",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "security company" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].matchType).not.toBe("low_confidence");
    });
  });

  // ========================================================================
  // Generic queries
  // ========================================================================
  describe("generic queries", () => {
    it("'consultancy' finds results but is marked generic", async () => {
      const candidate = makeCandidate({
        officialName: "Management Consultancy",
        normalizedName: "management consultancy",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "consultancy" });
      expect(res.intent.isGenericQuery).toBe(true);
      expect(res.total).toBeGreaterThanOrEqual(1);
    });

    it("'trading' finds results and is marked generic", async () => {
      const candidate = makeCandidate({
        officialName: "General Trading",
        normalizedName: "general trading",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "trading" });
      expect(res.intent.isGenericQuery).toBe(true);
      expect(res.total).toBeGreaterThanOrEqual(1);
    });

    it("'technology' finds results", async () => {
      const candidate = makeCandidate({
        officialName: "Technology",
        normalizedName: "technology",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "technology" });
      expect(res.total).toBeGreaterThanOrEqual(1);
    });

    it("'services' is marked generic", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "services" });
      expect(res.intent.isGenericQuery).toBe(true);
    });
  });

  // ========================================================================
  // Scoring hierarchy
  // ========================================================================
  describe("scoring hierarchy", () => {
    it("exact match scores 1.0", async () => {
      const candidate = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "restaurant" });
      const exact = res.results.find((r) => r.matchType === "exact");
      expect(exact).toBeDefined();
      expect(exact!.matchScore).toBe(1.0);
    });

    it("strong matches score >= 0.92", async () => {
      const candidate = makeCandidate({
        officialName: "Healthcare Clinic",
        normalizedName: "healthcare clinic",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "medical clinic" });
      const strong = res.results.filter((r) => r.matchType === "strong");
      expect(strong.length).toBeGreaterThanOrEqual(1);
      for (const s of strong) {
        expect(s.matchScore).toBeGreaterThanOrEqual(0.92);
      }
    });

    it("no result has score below MIN_RELEVANCE (0.62)", async () => {
      const candidates = [
        makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant", id: "a1" }),
        makeCandidate({ officialName: "Medical Clinic", normalizedName: "medical clinic", id: "a2" }),
        makeCandidate({ officialName: "Food Trading", normalizedName: "food trading", id: "a3" }),
        makeCandidate({ officialName: "Logistics Company", normalizedName: "logistics company", id: "a4" }),
      ];
      setupDbMock(candidates);
      const res = await searchUnified({ q: "restaurant" });
      for (const r of res.results) {
        expect(r.matchScore).toBeGreaterThanOrEqual(0.62);
      }
    });

    it("results are sorted by matchType priority then score", async () => {
      const candidates = [
        makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant", id: "a1" }),
        makeCandidate({
          officialName: "Restaurant Equipment Trading",
          normalizedName: "restaurant equipment trading",
          id: "a2",
        }),
      ];
      setupDbMock(candidates);
      const res = await searchUnified({ q: "restaurant" });
      if (res.results.length >= 2) {
        const typePriority: Record<string, number> = {
          exact: 0,
          strong: 1,
          related: 2,
          low_confidence: 3,
          ai_suggestion: 4,
        };
        for (let i = 1; i < res.results.length; i++) {
          const prev = typePriority[res.results[i - 1].matchType];
          const curr = typePriority[res.results[i].matchType];
          expect(prev).toBeLessThanOrEqual(curr);
          if (prev === curr) {
            expect(res.results[i - 1].matchScore).toBeGreaterThanOrEqual(res.results[i].matchScore);
          }
        }
      }
    });
  });

  // ========================================================================
  // Negative / excluded term filtering
  // ========================================================================
  describe("negative match filtering", () => {
    it("excludes activities with excluded terms for medical clinic", async () => {
      const goodCandidate = makeCandidate({
        officialName: "Medical Clinic",
        normalizedName: "medical clinic",
        id: "good",
      });
      const badCandidate = makeCandidate({
        officialName: "Medical Equipment Trading",
        normalizedName: "medical equipment trading",
        id: "bad",
      });
      setupDbMock([goodCandidate, badCandidate]);
      const res = await searchUnified({ q: "medical clinic" });
      const names = res.results.map((r) => r.activity.officialName);
      expect(names).toContain("Medical Clinic");
      expect(names).not.toContain("Medical Equipment Trading");
    });

    it("excludes travel agency for digital marketing query", async () => {
      const travel = makeCandidate({
        officialName: "Travel Agency Services",
        normalizedName: "travel agency services",
        id: "travel",
      });
      const marketing = makeCandidate({
        officialName: "Digital Marketing Agency",
        normalizedName: "digital marketing agency",
        id: "marketing",
      });
      setupDbMock([travel, marketing]);
      const res = await searchUnified({ q: "digital marketing agency" });
      const names = res.results.map((r) => r.activity.officialName);
      expect(names).not.toContain("Travel Agency Services");
    });
  });

  // ========================================================================
  // Filter options
  // ========================================================================
  describe("filter options", () => {
    it("filters by emirate", async () => {
      const dubaiCandidate = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
        emirate: "dubai",
        id: "dubai-1",
      });
      const abuDhabiCandidate = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
        emirate: "abu_dhabi",
        jurisdictionId: "jur-2",
        jurisdictionName: "ADGM",
        jurisdictionSlug: "adgm",
        id: "adh-1",
      });
      setupDbMock([dubaiCandidate, abuDhabiCandidate], [
        makeJurisdictionRow(),
        makeJurisdictionRow({ id: "jur-2", slug: "adgm", name: "ADGM", emirate: "abu_dhabi" }),
      ]);
      const res = await searchUnified({ q: "restaurant", emirate: "dubai" });
      for (const r of res.results) {
        expect(r.jurisdiction.emirate).toBe("dubai");
      }
    });

    it("filters by jurisdictionType", async () => {
      const freeZone = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
        jurisdictionType: "free_zone",
        id: "fz-1",
      });
      const mainland = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
        jurisdictionType: "mainland",
        jurisdictionId: "jur-ml",
        jurisdictionName: "Dubai mainland",
        jurisdictionSlug: "dubai-mainland",
        id: "ml-1",
      });
      setupDbMock([freeZone, mainland]);
      const res = await searchUnified({ q: "restaurant", jurisdictionType: "free_zone" });
      for (const r of res.results) {
        expect(r.jurisdiction.jurisdictionType).toBe("free_zone");
      }
    });

    it("applies limit and offset", async () => {
      const candidates = Array.from({ length: 10 }, (_, i) =>
        makeCandidate({
          officialName: `Restaurant ${i}`,
          normalizedName: `restaurant ${i}`,
          id: `act-${i}`,
        }),
      );
      setupDbMock(candidates);
      const res = await search({ q: "restaurant", limit: 3, offset: 0 });
      expect(res.length).toBeLessThanOrEqual(3);
    });
  });

  // ========================================================================
  // Jurisdiction grouping
  // ========================================================================
  describe("jurisdiction grouping", () => {
    it("groups results by jurisdiction", async () => {
      const candidates = [
        makeCandidate({
          officialName: "Restaurant",
          normalizedName: "restaurant",
          id: "a1",
          emirate: "dubai",
          jurisdictionId: "jur-1",
          jurisdictionName: "DMCC",
          jurisdictionSlug: "dmcc",
        }),
        makeCandidate({
          officialName: "Restaurant",
          normalizedName: "restaurant",
          id: "a2",
          emirate: "abu_dhabi",
          jurisdictionId: "jur-2",
          jurisdictionName: "ADGM",
          jurisdictionSlug: "adgm",
        }),
      ];
      setupDbMock(candidates, [
        makeJurisdictionRow(),
        makeJurisdictionRow({ id: "jur-2", slug: "adgm", name: "ADGM", emirate: "abu_dhabi" }),
      ]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res.jurisdictionGroups.length).toBeGreaterThanOrEqual(2);
      const dmccGroup = res.jurisdictionGroups.find((g) => g.jurisdiction.slug === "dmcc");
      const adgmGroup = res.jurisdictionGroups.find((g) => g.jurisdiction.slug === "adgm");
      expect(dmccGroup).toBeDefined();
      expect(adgmGroup).toBeDefined();
      expect(dmccGroup!.status).toBe("match");
      expect(adgmGroup!.status).toBe("match");
    });

    it("reports unmatched jurisdictions as no_match", async () => {
      const candidates = [
        makeCandidate({
          officialName: "Restaurant",
          normalizedName: "restaurant",
          id: "a1",
          jurisdictionId: "jur-1",
        }),
      ];
      setupDbMock(candidates, [
        makeJurisdictionRow(),
        makeJurisdictionRow({ id: "jur-2", slug: "adgm", name: "ADGM" }),
      ]);
      const res = await searchUnified({ q: "restaurant" });
      const noMatch = res.jurisdictionGroups.filter((g) => g.status === "no_match");
      expect(noMatch.length).toBeGreaterThanOrEqual(1);
      expect(res.availability.unmatched.length).toBeGreaterThanOrEqual(1);
    });

    it("availability.matchedJurisdictionSlugs lists matching slugs", async () => {
      const candidates = [
        makeCandidate({
          officialName: "Restaurant",
          normalizedName: "restaurant",
          id: "a1",
          jurisdictionId: "jur-1",
          jurisdictionSlug: "dmcc",
        }),
      ];
      setupDbMock(candidates, [makeJurisdictionRow()]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res.availability.matchedJurisdictionSlugs).toContain("dmcc");
    });
  });

  // ========================================================================
  // Deduplication
  // ========================================================================
  describe("deduplication", () => {
    it("keeps highest-scoring version when same activity appears multiple times", async () => {
      const lowScoreCandidate = makeCandidate({
        officialName: "Food Products Trading",
        normalizedName: "food products trading",
        id: "same-1",
        officialCategory: "Food",
      });
      const highScoreCandidate = makeCandidate({
        officialName: "Food Trading",
        normalizedName: "food trading",
        id: "same-1",
      });
      setupDbMock([lowScoreCandidate, highScoreCandidate]);
      const res = await searchUnified({ q: "food trading" });
      const ids = res.results.map((r) => r.activity.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  // ========================================================================
  // generateAISuggestions
  // ========================================================================
  describe("generateAISuggestions", () => {
    it("returns array of strings", () => {
      const intent: BusinessIntent = {
        primaryNoun: "clinic",
        qualifiers: ["medical", "healthcare", "health"],
        industryDomain: "healthcare",
        requiredTerms: ["clinic"],
        excludedTerms: [],
        isGenericQuery: false,
        specificityLevel: "specific",
      };
      const suggestions = generateAISuggestions("medical clinic", intent);
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThan(0);
      for (const s of suggestions) {
        expect(typeof s).toBe("string");
      }
    });

    it("returns at most 5 suggestions", () => {
      const intent: BusinessIntent = {
        primaryNoun: "marketing",
        qualifiers: ["digital", "online", "advertising", "seo", "ppc", "social"],
        industryDomain: "media",
        requiredTerms: ["marketing"],
        excludedTerms: [],
        isGenericQuery: false,
        specificityLevel: "specific",
      };
      const suggestions = generateAISuggestions("digital marketing", intent);
      expect(suggestions.length).toBeLessThanOrEqual(5);
    });

    it("includes required terms in suggestions", () => {
      const intent: BusinessIntent = {
        primaryNoun: "software",
        qualifiers: ["development", "programming"],
        industryDomain: "technology",
        requiredTerms: ["software"],
        excludedTerms: [],
        isGenericQuery: false,
        specificityLevel: "specific",
      };
      const suggestions = generateAISuggestions("software development", intent);
      expect(suggestions).toContain("software");
    });

    it("returns empty array when intent has no qualifiers or required terms", () => {
      const intent: BusinessIntent = {
        primaryNoun: "test",
        qualifiers: [],
        industryDomain: "general",
        requiredTerms: [],
        excludedTerms: [],
        isGenericQuery: true,
        specificityLevel: "broad",
      };
      const suggestions = generateAISuggestions("test", intent);
      expect(suggestions).toEqual([]);
    });
  });

  // ========================================================================
  // Edge cases
  // ========================================================================
  describe("edge cases", () => {
    it("handles query with only stop words gracefully", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "want to start a" });
      expect(res.total).toBe(0);
      expect(res.results).toHaveLength(0);
    });

    it("handles query with special characters", async () => {
      const candidate = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "restaurant!" });
      expect(res.total).toBeGreaterThanOrEqual(0);
    });

    it("handles very long query", async () => {
      setupDbMock([]);
      const longQuery = "a ".repeat(100) + "restaurant";
      const res = await searchUnified({ q: longQuery });
      expect(res.total).toBe(0);
    });

    it("meta.minRelevanceThreshold is 0.62", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res.meta.minRelevanceThreshold).toBe(0.62);
    });

    it("returns performance metadata with tookMs >= 0", async () => {
      setupDbMock([]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res.meta.tookMs).toBeGreaterThanOrEqual(0);
    });

    it("reports candidatesEvaluated", async () => {
      const candidates = [
        makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant", id: "a1" }),
        makeCandidate({ officialName: "Cafe", normalizedName: "cafe", id: "a2" }),
      ];
      setupDbMock(candidates);
      const res = await searchUnified({ q: "restaurant" });
      expect(typeof res.meta.candidatesEvaluated).toBe("number");
      expect(res.meta.candidatesEvaluated).toBeGreaterThanOrEqual(0);
    });

    it("result items contain matchReasons array", async () => {
      const candidate = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "restaurant" });
      if (res.results.length > 0) {
        expect(Array.isArray(res.results[0].matchReasons)).toBe(true);
        expect(res.results[0].matchReasons.length).toBeGreaterThan(0);
      }
    });

    it("result items have correct nested shapes", async () => {
      const candidate = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "restaurant" });
      if (res.results.length > 0) {
        const item = res.results[0];
        expect(item.activity).toHaveProperty("id");
        expect(item.activity).toHaveProperty("officialName");
        expect(item.activity).toHaveProperty("normalizedName");
        expect(item.activity).toHaveProperty("approvalSignal");
        expect(item.jurisdiction).toHaveProperty("id");
        expect(item.jurisdiction).toHaveProperty("name");
        expect(item.jurisdiction).toHaveProperty("slug");
        expect(item.jurisdiction).toHaveProperty("emirate");
        expect(item.jurisdiction).toHaveProperty("jurisdictionType");
      }
    });
  });

  // ========================================================================
  // Multiple result types in one query
  // ========================================================================
  describe("mixed result types", () => {
    it("returns both exact and strong matches together", async () => {
      const exact = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
        id: "a1",
      });
      const strong = makeCandidate({
        officialName: "Medical Clinic",
        normalizedName: "medical clinic",
        id: "a2",
      });
      setupDbMock([exact, strong]);
      const res = await searchUnified({ q: "restaurant" });
      const matchTypes = res.results.map((r) => r.matchType);
      expect(matchTypes).toContain("exact");
    });

    it("multiple candidates with same name in different jurisdictions all appear", async () => {
      const c1 = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
        id: "a1",
        jurisdictionId: "jur-1",
        jurisdictionSlug: "dmcc",
      });
      const c2 = makeCandidate({
        officialName: "Restaurant",
        normalizedName: "restaurant",
        id: "a2",
        jurisdictionId: "jur-2",
        jurisdictionSlug: "adgm",
        jurisdictionName: "ADGM",
      });
      setupDbMock([c1, c2], [
        makeJurisdictionRow(),
        makeJurisdictionRow({ id: "jur-2", slug: "adgm", name: "ADGM" }),
      ]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res.total).toBeGreaterThanOrEqual(2);
    });
  });

  // ========================================================================
  // Word variation / stemming
  // ========================================================================
  describe("word variations and stemming", () => {
    it("'accounting' matches 'Accounting and Bookkeeping' via qualifier expansion", async () => {
      const candidate = makeCandidate({
        officialName: "Accounting and Bookkeeping",
        normalizedName: "accounting and bookkeeping",
        officialCategory: "Professional Services",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "accounting" });
      expect(res.total).toBeGreaterThanOrEqual(1);
    });

    it("'consulting' matches 'Consulting Services' via generic word match", async () => {
      const candidate = makeCandidate({
        officialName: "Consulting Services",
        normalizedName: "consulting services",
      });
      setupDbMock([candidate]);
      const res = await searchUnified({ q: "consulting" });
      expect(res.total).toBeGreaterThanOrEqual(1);
    });
  });
});
