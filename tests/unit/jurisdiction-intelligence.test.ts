import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UnifiedSearchResponse, SearchResultItem, JurisdictionGroup } from "@/lib/search/types";
import type { RegulatorySummary } from "@/lib/search/enrichment";

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockSearchUnified = vi.fn();
const mockGetRegulatorySummaries = vi.fn();

vi.mock("@/lib/search/engine", () => ({
  searchUnified: (...args: unknown[]) => mockSearchUnified(...args),
}));
vi.mock("@/lib/search/enrichment", async importOriginal => {
  // `collectRenderedActivityIds` is pure and is what decides WHICH activities get
  // enriched, so it runs for real here; only the database-backed lookup is mocked.
  const actual = await importOriginal<
    typeof import("@/lib/search/enrichment")
  >();
  return {
    collectRenderedActivityIds: actual.collectRenderedActivityIds,
    getRegulatorySummaries: (...args: unknown[]) => mockGetRegulatorySummaries(...args),
  };
});

// Import AFTER mocks
import { getJurisdictionIntelligence } from "@/lib/search/jurisdiction-intelligence";
import {
  buildComparisonDimensions,
  getBestSupportedMatches,
  type JurisdictionMatch,
} from "@/lib/search/jurisdiction-intelligence";

// ─── Fixture builders ─────────────────────────────────────────────────────

const ZONES: Record<string, { id: string; slug: string; name: string }> = {
  dmcc: { id: "jur-dmcc", slug: "dmcc", name: "DMCC" },
  rakez: { id: "jur-rakez", slug: "rakez", name: "RAKEZ" },
  spc: { id: "jur-spc", slug: "spc", name: "SPC Free Zone" },
  afz: { id: "jur-afz", slug: "afz", name: "Ajman Free Zone" },
  ifza: { id: "jur-ifza", slug: "ifza", name: "IFZA" },
};

function jurisdiction(slug: string) {
  const z = ZONES[slug];
  return {
    id: z.id,
    name: z.name,
    slug: z.slug,
    emirate: "dubai",
    jurisdictionType: "free_zone",
  };
}

function makeItem(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    activity: {
      id: "act-1",
      officialName: "Restaurant",
      normalizedName: "restaurant",
      activityCode: "5520-01",
      isicCode: null,
      description: null,
      officialCategory: "Food",
      activityGroup: "Food & Beverage",
      approvalSignal: "no_signal",
      approvalStatus: "unknown",
      verificationStatus: "verified",
      lastVerified: "2026-01-01",
    },
    jurisdiction: jurisdiction("dmcc"),
    licenceType: { id: "lt-1", name: "Restaurant Licence", code: "REST01" },
    matchType: "exact",
    matchScore: 1.0,
    matchReasons: ["Exact official activity match"],
    source: {
      id: "src-1",
      url: "https://example.com/activities",
      title: "Official Activity List",
      lastVerified: "2026-01-01",
    },
    ...overrides,
  };
}

function makeGroup(overrides: Partial<JurisdictionGroup>): JurisdictionGroup {
  return {
    jurisdiction: jurisdiction("dmcc"),
    status: "match",
    totalMatches: 1,
    bestMatchType: "exact",
    topResults: [makeItem()],
    ...overrides,
  };
}

function makeSearchData(overrides: Partial<UnifiedSearchResponse> = {}): UnifiedSearchResponse {
  return {
    query: "restaurant",
    total: 1,
    results: [makeItem()],
    jurisdictionGroups: [makeGroup({})],
    availability: {
      matchedJurisdictionSlugs: ["dmcc"],
      unmatched: [jurisdiction("ifza")],
    },
    intent: {
      primaryNoun: "restaurant",
      industryDomain: "food",
      specificityLevel: "broad",
      isGenericQuery: false,
      searchIntents: ["ACTIVITY_SEARCH"],
      jurisdictionSlug: null,
      jurisdictionName: null,
      businessTerms: ["restaurant"],
      typoCorrected: false,
    },
    meta: { tookMs: 10, candidatesEvaluated: 5, minRelevanceThreshold: 0.62 },
    ...overrides,
  };
}

const EMPTY_SUMMARY: RegulatorySummary = {
  verifiedApprovals: [],
  govFees: [],
  thirdPartyCosts: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRegulatorySummaries.mockResolvedValue(new Map());
});

// ===========================================================================
describe("Jurisdiction intelligence - response structure", () => {
  it("returns query, intent, jurisdictions and meta", async () => {
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    expect(res.query).toBe("restaurant");
    expect(res.intent).toBeDefined();
    expect(Array.isArray(res.jurisdictions)).toBe(true);
    expect(res.meta.indexedJurisdictions).toBeGreaterThan(0);
  });

  it("returns the original query unchanged", async () => {
    mockSearchUnified.mockResolvedValue(makeSearchData({ query: "restaurant" }));
    const res = await getJurisdictionIntelligence("restaurant");
    expect(res).toHaveProperty("query", "restaurant");
  });

  it("reports taken ms >= 0", async () => {
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    expect(res.meta.tookMs).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
describe("Jurisdiction intelligence - enrichment scope", () => {
  it("enriches exactly the activities it renders, not the whole flat page", async () => {
    // Grouped analysis is unpaged, so the flat `results` array holds every match
    // while each group renders only its top N. Enriching the flat array would
    // query thousands of activity ids to fill in a handful of cards.
    const dmccTop = makeItem({ activity: { ...makeItem().activity, id: "a-dmcc" } });
    const rakezTop = makeItem({ activity: { ...makeItem().activity, id: "a-rakez" } });
    const offTop = makeItem({ activity: { ...makeItem().activity, id: "a-unranked" } });

    mockSearchUnified.mockResolvedValue(
      makeSearchData({
        total: 3,
        results: [dmccTop, rakezTop, offTop],
        jurisdictionGroups: [
          makeGroup({ jurisdiction: jurisdiction("dmcc"), topResults: [dmccTop] }),
          makeGroup({ jurisdiction: jurisdiction("rakez"), topResults: [rakezTop] }),
        ],
      })
    );

    await getJurisdictionIntelligence("restaurant");

    expect(mockGetRegulatorySummaries).toHaveBeenCalledTimes(1);
    expect(mockGetRegulatorySummaries.mock.calls[0]![0]).toEqual(["a-dmcc", "a-rakez"]);
  });

  it("opts out of paging so every jurisdiction gets its best match", async () => {
    mockSearchUnified.mockResolvedValue(makeSearchData());
    await getJurisdictionIntelligence("restaurant");
    expect(mockSearchUnified.mock.calls[0]![0]).toMatchObject({ allMatches: true });
  });
});

// ===========================================================================
describe("Jurisdiction intelligence - MATCH status", () => {
  it("one jurisdiction match", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({})] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    expect(res.jurisdictions).toHaveLength(1);
    expect(res.jurisdictions[0].status).toBe("MATCH");
    expect(res.meta.totalMatched).toBe(1);
    expect(res.meta.totalUnmatched).toBe(0);
  });

  it("multiple jurisdiction matches", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({
        jurisdictionGroups: [
          makeGroup({
            jurisdiction: jurisdiction("dmcc"),
            topResults: [makeItem({ activity: { ...makeItem().activity, id: "a-dmcc" } })],
          }),
          makeGroup({
            jurisdiction: jurisdiction("rakez"),
            topResults: [makeItem({ activity: { ...makeItem().activity, id: "a-rakez" } })],
          }),
        ],
      })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    expect(res.jurisdictions).toHaveLength(2);
    expect(res.jurisdictions.every(j => j.status === "MATCH")).toBe(true);
    expect(res.meta.totalMatched).toBe(2);
  });

  it("exposes the actual matched activity via bestMatch", async () => {
    const item = makeItem({ activity: { ...makeItem().activity, officialName: "Restaurant", activityCode: "5520-01" } });
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({ topResults: [item] })] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const m = res.jurisdictions[0];
    expect(m.bestMatch?.activity.officialName).toBe("Restaurant");
    expect(m.bestMatch?.activity.activityCode).toBe("5520-01");
  });

  it("labels match reason as matched in indexed official data", async () => {
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    expect(res.jurisdictions[0].reason).toContain("indexed official activity data");
    expect(res.jurisdictions[0].reason).toContain("exact");
  });
});

// ===========================================================================
describe("Jurisdiction intelligence - NO_MATCH status", () => {
  it("reports NO_MATCH for jurisdictions with no matching activity", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({
        jurisdictionGroups: [makeGroup({ status: "no_match", topResults: [], bestMatchType: null, totalMatches: 0 })],
      })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const m = res.jurisdictions[0];
    expect(m.status).toBe("NO_MATCH");
    expect(m.reason).toContain("No matching activity found in indexed official data");
    expect(m.bestMatch).toBeNull();
  });

  it("does NOT interpret 'no match' as prohibited", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({
        jurisdictionGroups: [makeGroup({ status: "no_match", topResults: [], bestMatchType: null, totalMatches: 0 })],
      })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const m = res.jurisdictions[0];
    expect(m.reason).not.toContain("prohibited");
    expect(m.reason).not.toContain("not allowed");
    expect(m.reason).toContain("indexed");
  });

  it("counts unmatched jurisdictions in meta", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({
        jurisdictionGroups: [
          makeGroup({}),
          makeGroup({ status: "no_match", topResults: [], bestMatchType: null, totalMatches: 0 }),
        ],
      })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    expect(res.meta.totalMatched).toBe(1);
    expect(res.meta.totalUnmatched).toBe(1);
  });
});

// ===========================================================================
describe("Jurisdiction intelligence - match quality", () => {
  it("preserves EXACT match type", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({ bestMatchType: "exact", topResults: [makeItem({ matchType: "exact" })] })] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    expect(res.jurisdictions[0].bestMatchType).toBe("exact");
  });

  it("preserves STRONG match type", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({ bestMatchType: "strong", topResults: [makeItem({ matchType: "strong" })] })] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    expect(res.jurisdictions[0].bestMatchType).toBe("strong");
  });

  it("preserves RELATED match type", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({ bestMatchType: "related", topResults: [makeItem({ matchType: "related" })] })] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    expect(res.jurisdictions[0].bestMatchType).toBe("related");
  });

  it("does not manufacture an activity for a matching jurisdiction", async () => {
    // Only a single weak related match exists — the layer must surface it,
    // not invent an exact activity.
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({ bestMatchType: "related", topResults: [makeItem({ matchType: "related", activity: { ...makeItem().activity, officialName: "Food Products Trading" } })] })] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    expect(res.jurisdictions[0].bestMatchType).toBe("related");
    expect(res.jurisdictions[0].bestMatch?.activity.officialName).toBe("Food Products Trading");
  });
});

// ===========================================================================
describe("Jurisdiction intelligence - licence intelligence", () => {
  it("exposes licence type and binding when present", async () => {
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    const li = res.jurisdictions[0].licenceIntelligence!;
    expect(li.licenceType).toBe("Restaurant Licence");
    expect(li.licenceBinding).toBe("verified");
    expect(li.officialActivityName).toBe("Restaurant");
    expect(li.isicCode).toBeNull();
  });

  it("marks licence binding as unknown when licenceType is null", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({ topResults: [makeItem({ licenceType: null })] })] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const li = res.jurisdictions[0].licenceIntelligence!;
    expect(li.licenceType).toBeNull();
    expect(li.licenceBinding).toBe("unknown");
  });

  it("exposes activity category and verification status", async () => {
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    const li = res.jurisdictions[0].licenceIntelligence!;
    expect(li.activityCategory).toBe("Food");
    expect(li.verificationStatus).toBe("verified");
    expect(li.jurisdiction).toBe("DMCC");
  });

  it("exposes source attribution and last verified date", async () => {
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    const li = res.jurisdictions[0].licenceIntelligence!;
    expect(li.source?.url).toContain("example.com");
    expect(li.source?.lastVerified).toBe("2026-01-01");
  });

  it("leaves unknown fields null (no fabrication)", async () => {
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    const li = res.jurisdictions[0].licenceIntelligence!;
    // These are not in the source — must remain null, not invented values.
    expect(li.propertyRequirement).toBeNull();
    expect(li.qualificationRequirement).toBeNull();
    expect(li.minimumShareCapital).toBeNull();
  });
});

// ===========================================================================
describe("Jurisdiction intelligence - approval intelligence", () => {
  it("distinguishes verified approval from a signal", async () => {
    // Verified approval present
    mockGetRegulatorySummaries.mockResolvedValue(
      new Map([["act-1", {
        verifiedApprovals: [{ name: "Dubai Municipality Permit", authorityName: "Dubai Municipality", lastVerified: "2026-01-01" }],
        govFees: [],
        thirdPartyCosts: [],
      }]])
    );
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    const ai = res.jurisdictions[0].approvalIntelligence;
    expect(ai.displayStatus).toBe("APPROVAL_VERIFIED");
    expect(ai.verifiedApprovals.length).toBe(1);
    expect(ai.verifiedApprovals[0].authorityName).toBe("Dubai Municipality");
  });

  it("reports approval signal present - verification pending", async () => {
    mockGetRegulatorySummaries.mockResolvedValue(new Map([["act-1", EMPTY_SUMMARY]]));
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({ topResults: [makeItem({ activity: { ...makeItem().activity, approvalSignal: "third_party_approval_indicated" } })] })] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const ai = res.jurisdictions[0].approvalIntelligence;
    expect(ai.displayStatus).toBe("APPROVAL_SIGNAL_PRESENT");
    expect(ai.displayText).toContain("verification pending");
    expect(ai.displayText).not.toContain("verified");
  });

  it("does not treat a signal as a verified approval", async () => {
    mockGetRegulatorySummaries.mockResolvedValue(new Map([["act-1", EMPTY_SUMMARY]]));
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({ topResults: [makeItem({ activity: { ...makeItem().activity, approvalSignal: "may_be_required" } })] })] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const ai = res.jurisdictions[0].approvalIntelligence;
    expect(ai.verifiedApprovals.length).toBe(0);
    expect(ai.displayStatus).toBe("APPROVAL_SIGNAL_PRESENT");
  });

  it("reports unknown approval requiring research", async () => {
    mockGetRegulatorySummaries.mockResolvedValue(new Map([["act-1", EMPTY_SUMMARY]]));
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({ topResults: [makeItem({ activity: { ...makeItem().activity, approvalSignal: "unknown", approvalStatus: "unknown" } })] })] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const ai = res.jurisdictions[0].approvalIntelligence;
    expect(ai.displayStatus).toBe("UNKNOWN_REQUIRES_RESEARCH");
    expect(ai.displayText).toContain("requires research");
  });

  it("reports no additional approval verified when source says so", async () => {
    mockGetRegulatorySummaries.mockResolvedValue(new Map([["act-1", EMPTY_SUMMARY]]));
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({ topResults: [makeItem({ activity: { ...makeItem().activity, approvalSignal: "no_signal", approvalStatus: "no_additional_approval" } })] })] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const ai = res.jurisdictions[0].approvalIntelligence;
    expect(ai.displayStatus).toBe("NO_ADDITIONAL_APPROVAL_VERIFIED");
  });

  it("NO_MATCH jurisdiction reports NOT_FOUND approval status", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({ jurisdictionGroups: [makeGroup({ status: "no_match", topResults: [], bestMatchType: null, totalMatches: 0 })] })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const ai = res.jurisdictions[0].approvalIntelligence;
    expect(ai.displayStatus).toBe("NOT_FOUND");
  });
});

// ===========================================================================
describe("Jurisdiction intelligence - cost intelligence", () => {
  it("separates government fees from third-party costs", async () => {
    mockGetRegulatorySummaries.mockResolvedValue(
      new Map([["act-1", {
        verifiedApprovals: [{ name: "Permit", authorityName: "Authority", lastVerified: "2026-01-01" }],
        govFees: [{ amount: "5000", currency: "AED", feeType: "approval_fee" }],
        thirdPartyCosts: [{ estimatedAmount: "1200", currency: "AED", costType: "laboratory" }],
      }]])
    );
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    const fi = res.jurisdictions[0].feeIntelligence;
    expect(fi.governmentFees).toHaveLength(1);
    expect(fi.thirdPartyCosts).toHaveLength(1);
    expect(fi.governmentFees[0].feeType).toBe("approval_fee");
    expect(fi.thirdPartyCosts[0].costType).toBe("laboratory");
  });

  it("never combines government fees with third-party costs", async () => {
    mockGetRegulatorySummaries.mockResolvedValue(
      new Map([["act-1", {
        verifiedApprovals: [{ name: "Permit", authorityName: "Authority", lastVerified: "2026-01-01" }],
        govFees: [{ amount: "500", currency: "AED", feeType: "permit_fee" }],
        thirdPartyCosts: [{ estimatedAmount: "900", currency: "AED", costType: "testing" }],
      }]])
    );
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    const fi = res.jurisdictions[0].feeIntelligence;
    expect(fi.governmentFees[0].amount).not.toBe(fi.thirdPartyCosts[0].estimatedAmount);
    expect(fi.governmentFees[0].feeType).toBe("permit_fee");
  });

  it("reports fee not verified when no fee records exist", async () => {
    mockGetRegulatorySummaries.mockResolvedValue(new Map([["act-1", EMPTY_SUMMARY]]));
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    const fi = res.jurisdictions[0].feeIntelligence;
    expect(fi.governmentFees).toHaveLength(0);
    expect(fi.displayText).toContain("not verified");
    // Never an invented AED 0
    expect(fi.displayText).not.toContain("AED 0");
  });

  it("does not show AED 0 unless source provided it", async () => {
    mockGetRegulatorySummaries.mockResolvedValue(new Map([["act-1", EMPTY_SUMMARY]]));
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    const fi = res.jurisdictions[0].feeIntelligence;
    expect(fi.governmentFees).toHaveLength(0);
  });

  it("exposes currency and amount on verified government fee", async () => {
    mockGetRegulatorySummaries.mockResolvedValue(
      new Map([["act-1", {
        verifiedApprovals: [{ name: "Permit", authorityName: "Authority", lastVerified: "2026-01-01" }],
        govFees: [{ amount: "2500", currency: "AED", feeType: "registration_fee" }],
        thirdPartyCosts: [],
      }]])
    );
    mockSearchUnified.mockResolvedValue(makeSearchData());
    const res = await getJurisdictionIntelligence("restaurant");
    const f = res.jurisdictions[0].feeIntelligence.governmentFees[0];
    expect(f.amount).toBe("2500");
    expect(f.currency).toBe("AED");
    expect(f.verificationStatus).toBe("verified");
  });
});

// ===========================================================================
describe("Jurisdiction intelligence - comparison dimensions", () => {
  function sampleMatches(): JurisdictionMatch[] {
    const match = (): JurisdictionMatch => ({
      jurisdiction: jurisdiction("dmcc"),
      status: "MATCH",
      reason: "Matched in indexed official activity data — exact match",
      matchedActivities: [makeItem()],
      bestMatch: makeItem(),
      bestMatchType: "exact",
      licenceIntelligence: {
        officialActivityName: "Restaurant",
        isicCode: null,
        licenceType: "Restaurant Licence",
        licenceBinding: "verified",
        jurisdiction: "DMCC",
        jurisdictionSlug: "dmcc",
        activityCategory: "Food",
        restrictions: null,
        propertyRequirement: null,
        qualificationRequirement: null,
        minimumShareCapital: null,
        source: { id: "s", url: "https://x", title: "Source", lastVerified: "2026-01-01" },
        verificationStatus: "verified",
        lastVerified: "2026-01-01",
      },
      approvalIntelligence: {
        displayStatus: "APPROVAL_VERIFIED",
        verifiedApprovals: [{ name: "Permit", authorityName: "Authority", approvalType: "regulatory_permit", requirement: null, applicationProcess: null, source: null, verificationStatus: "verified", lastVerified: "2026-01-01" }],
        signals: [],
        displayText: "Approval verified in indexed official data",
      },
      feeIntelligence: {
        governmentFees: [{ amount: "5000", currency: "AED", feeType: "approval_fee", feeBasis: "fixed", conditions: null, sourceId: null, lastVerified: null, verificationStatus: "verified" }],
        thirdPartyCosts: [],
        sourceActivityPrices: [],
        displayText: "Some fees verified in indexed official sources",
      },
      regulatorySummary: null,
    });

    const noMatch = (): JurisdictionMatch => ({
      jurisdiction: jurisdiction("ifza"),
      status: "NO_MATCH",
      reason: "No matching activity found in indexed official data",
      matchedActivities: [],
      bestMatch: null,
      bestMatchType: null,
      licenceIntelligence: null,
      approvalIntelligence: { displayStatus: "NOT_FOUND", verifiedApprovals: [], signals: [], displayText: "Not found" },
      feeIntelligence: { governmentFees: [], thirdPartyCosts: [], sourceActivityPrices: [], displayText: "Not found" },
      regulatorySummary: null,
    });

    return [match(), noMatch()];
  }

  it("produces data-driven dimensions across jurisdictions", () => {
    const dims = buildComparisonDimensions(sampleMatches());
    expect(dims.length).toBeGreaterThan(10);
    const activityDim = dims.find(d => d.label === "Activity availability")!;
    expect(activityDim.values["dmcc"]).toContain("Matched");
    expect(activityDim.values["ifza"]).toContain("Not found");
  });

  it("marks unavailable data as not verified", () => {
    const dims = buildComparisonDimensions(sampleMatches());
    const matchQuality = dims.find(d => d.label === "Match quality")!;
    expect(matchQuality.values["ifza"]).toBe("N/A");
    const propDim = dims.find(d => d.label === "Property requirement")!;
    expect(propDim.values["dmcc"]).toBe("Not verified");
  });

  it("does not create an arbitrary best jurisdiction score", () => {
    const dims = buildComparisonDimensions(sampleMatches());
    // No dimension that claims a winner by assumption
    const labels = dims.map(d => d.label);
    expect(labels).not.toContain("Best jurisdiction");
    expect(labels).not.toContain("Recommendation");
  });

  it("best-supported matches is evidence-based and labeled", () => {
    const matches = sampleMatches().filter(m => m.status === "MATCH");
    const best = getBestSupportedMatches(matches);
    expect(best.label).toBe("Best-supported matches");
    expect(best.disclaimer).toContain("not professional, legal or business advice");
    expect(best.ranked.length).toBeGreaterThan(0);
    expect(best.ranked[0].evidenceScore).toBeGreaterThanOrEqual(4);
    expect(best.ranked[0].evidenceFactors).toContain("exact match");
  });
});

// ===========================================================================
describe("Jurisdiction intelligence - no fabricated data", () => {
  it("never invents jurisdiction support for a NO_MATCH jurisdiction", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({
        jurisdictionGroups: [makeGroup({ status: "no_match", topResults: [], bestMatchType: null, totalMatches: 0 })],
      })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const m = res.jurisdictions[0];
    expect(m.bestMatch).toBeNull();
    expect(m.matchedActivities).toEqual([]);
    expect(m.licenceIntelligence).toBeNull();
  });

  it("never reports a licence for a jurisdiction without a match", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({
        jurisdictionGroups: [makeGroup({ status: "no_match", topResults: [], bestMatchType: null, totalMatches: 0 })],
      })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const m = res.jurisdictions[0];
    expect(m.licenceIntelligence).toBeNull();
  });

  it("every matched activity belongs to the returned jurisdiction", async () => {
    mockSearchUnified.mockResolvedValue(
      makeSearchData({
        jurisdictionGroups: [
          makeGroup({
            jurisdiction: jurisdiction("dmcc"),
            topResults: [makeItem({ activity: { ...makeItem().activity, id: "a1" } })],
          }),
        ],
      })
    );
    const res = await getJurisdictionIntelligence("restaurant");
    const m = res.jurisdictions[0];
    for (const act of m.matchedActivities) {
      expect(act.jurisdiction.slug).toBe(m.jurisdiction.slug);
    }
  });
});

// ===========================================================================
describe("Jurisdiction intelligence - API validation / sanitization", () => {
  it("propagates empty result gracefully (no crash)", async () => {
    mockSearchUnified.mockResolvedValue(makeSearchData({ results: [], jurisdictionGroups: [], total: 0 }));
    const res = await getJurisdictionIntelligence("zzzzz");
    expect(res.jurisdictions).toHaveLength(0);
    expect(res.meta.indexedJurisdictions).toBe(0);
  });

  it("handles empty query without inventing data", async () => {
    mockSearchUnified.mockResolvedValue(makeSearchData({ results: [], jurisdictionGroups: [], total: 0 }));
    const res = await getJurisdictionIntelligence("");
    expect(res.jurisdictions).toEqual([]);
  });
});
