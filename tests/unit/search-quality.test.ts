import { describe, it, expect, vi, beforeEach } from "vitest";

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
  approvalSignal?: string;
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

/** Mirrors the flat alias shape the engine's UNION ALL candidate query returns. */
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

function setupDbMock(candidateRows: unknown[], jurisdictionRows?: unknown[]) {
  dbMock.execute.mockReset();
  const jRows = jurisdictionRows ?? [makeJurisdictionRow()];
  dbMock.execute.mockImplementation(() =>
    Promise.resolve([
      ...(candidateRows as any[]).map(toFlatCandidate),
      ...jRows.map(toFlatAvailabilityRow),
    ]));
}

import { searchUnified } from "@/lib/search/engine";

const ALL_ZONES = [
  makeJurisdictionRow({ id: "rakez", slug: "rakez", name: "RAKEZ" }),
  makeJurisdictionRow({ id: "spc", slug: "spc", name: "SPC Free Zone" }),
  makeJurisdictionRow({ id: "afz", slug: "afz", name: "Ajman Free Zone" }),
  makeJurisdictionRow({ id: "dmcc", slug: "dmcc", name: "DMCC" }),
  makeJurisdictionRow({ id: "ifza", slug: "ifza", name: "IFZA" }),
];

function resNames(res: Awaited<ReturnType<typeof searchUnified>>) {
  return res.results.map((r) => r.activity.officialName);
}

describe("STEP 6 search quality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =====================================================================
  // (A) JURISDICTION-AWARE SEARCH
  // =====================================================================
  describe("A: jurisdiction-aware search", () => {
    it("A1 'restaurant in RAKEZ' filters to RAKEZ only", async () => {
      setupDbMock(
        [
          makeCandidate({ id: "r1", officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "rakez", jurisdictionSlug: "rakez", jurisdictionName: "RAKEZ" }),
          makeCandidate({ id: "r2", officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "dmcc", jurisdictionSlug: "dmcc", jurisdictionName: "DMCC" }),
        ],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "restaurant in RAKEZ" });
      expect(res.total).toBe(1);
      expect(res.results.every((r) => r.jurisdiction.slug === "rakez")).toBe(true);
      expect(res.intent.jurisdictionSlug).toBe("rakez");
      expect(res.intent.businessTerms).toEqual(["restaurant"]);
    });

    it("A2 'clinic in DMCC' filters to DMCC", async () => {
      setupDbMock(
        [
          makeCandidate({ id: "c1", officialName: "Medical Clinic", normalizedName: "medical clinic", jurisdictionId: "dmcc", jurisdictionSlug: "dmcc" }),
          makeCandidate({ id: "c2", officialName: "Medical Clinic", normalizedName: "medical clinic", jurisdictionId: "afz", jurisdictionSlug: "afz", jurisdictionName: "Ajman Free Zone" }),
        ],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "clinic in DMCC" });
      expect(res.results.length).toBe(1);
      expect(res.results[0].jurisdiction.slug).toBe("dmcc");
      expect(res.intent.jurisdictionSlug).toBe("dmcc");
    });

    it("A3 'trading company in Ajman Free Zone' filters to AFZ", async () => {
      setupDbMock(
        [
          makeCandidate({ id: "t1", officialName: "Trading and Services Company", normalizedName: "trading and services company", jurisdictionId: "afz", jurisdictionSlug: "afz", jurisdictionName: "Ajman Free Zone" }),
          makeCandidate({ id: "t2", officialName: "Trading and Services Company", normalizedName: "trading and services company", jurisdictionId: "dmcc", jurisdictionSlug: "dmcc" }),
        ],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "trading company in Ajman Free Zone" });
      expect(res.results.length).toBe(1);
      expect(res.results[0].jurisdiction.slug).toBe("afz");
      expect(res.intent.jurisdictionSlug).toBe("afz");
    });

    it("A4 'cafe in IFZA' filters to IFZA", async () => {
      setupDbMock(
        [
          makeCandidate({ id: "k1", officialName: "Cafe", normalizedName: "cafe", jurisdictionId: "ifza", jurisdictionSlug: "ifza" }),
          makeCandidate({ id: "k2", officialName: "Cafe", normalizedName: "cafe", jurisdictionId: "rakez", jurisdictionSlug: "rakez", jurisdictionName: "RAKEZ" }),
        ],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "cafe in IFZA" });
      expect(res.results.length).toBe(1);
      expect(res.results[0].jurisdiction.slug).toBe("ifza");
    });

    it("A5 'spc free zone courier services' filters to SPC", async () => {
      setupDbMock(
        [
          makeCandidate({ id: "u1", officialName: "Courier Services", normalizedName: "courier services", jurisdictionId: "spc", jurisdictionSlug: "spc", jurisdictionName: "SPC Free Zone" }),
          makeCandidate({ id: "u2", officialName: "Courier Services", normalizedName: "courier services", jurisdictionId: "dmcc", jurisdictionSlug: "dmcc" }),
        ],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "spc free zone courier services" });
      expect(res.results.length).toBe(1);
      expect(res.results[0].jurisdiction.slug).toBe("spc");
    });

    it("A6 'dubai multi commodities centre brokerage' maps to DMCC", async () => {
      setupDbMock(
        [
          makeCandidate({ id: "b1", officialName: "Brokerage", normalizedName: "brokerage", jurisdictionId: "dmcc", jurisdictionSlug: "dmcc" }),
        ],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "dubai multi commodities centre brokerage" });
      expect(res.intent.jurisdictionSlug).toBe("dmcc");
      expect(res.results[0].jurisdiction.slug).toBe("dmcc");
    });

    it("A7 'restaurant in Ras Al Khaimah' maps to RAKEZ", async () => {
      setupDbMock(
        [makeCandidate({ id: "a7", officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "rakez", jurisdictionSlug: "rakez", jurisdictionName: "RAKEZ" })],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "restaurant in Ras Al Khaimah" });
      expect(res.intent.jurisdictionSlug).toBe("rakez");
      expect(res.results.length).toBe(1);
    });
  });

  // =====================================================================
  // (B) NATURAL BUSINESS LANGUAGE
  // =====================================================================
  describe("B: natural business language", () => {
    it("B1 'I want to start a restaurant'", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "I want to start a restaurant" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].activity.officialName).toBe("Restaurant");
    });

    it("B2 'we are planning a digital marketing agency'", async () => {
      setupDbMock([makeCandidate({ officialName: "Digital Marketing Agency", normalizedName: "digital marketing agency" })]);
      const res = await searchUnified({ q: "we are planning a digital marketing agency" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].matchScore).toBe(1.0);
    });

    it("B3 'set up a jewellery trading company'", async () => {
      setupDbMock([makeCandidate({ officialName: "Jewellery Trading", normalizedName: "jewellery trading" })]);
      const res = await searchUnified({ q: "set up a jewellery trading company" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });

    it("B4 'looking to open a coffee shop'", async () => {
      setupDbMock([makeCandidate({ officialName: "Coffee Shop", normalizedName: "coffee shop" })]);
      const res = await searchUnified({ q: "looking to open a coffee shop" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].matchType).toBe("exact");
    });

    it("B5 'I am thinking of starting a clothing brand'", async () => {
      setupDbMock([makeCandidate({ officialName: "Clothing Brand", normalizedName: "clothing brand" })]);
      const res = await searchUnified({ q: "I am thinking of starting a clothing brand" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].matchType).toBe("exact");
    });

    it("B6 'how can I get a licence to open a restaurant in DMCC'", async () => {
      setupDbMock(
        [makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "dmcc", jurisdictionSlug: "dmcc" })],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "how can I get a licence to open a restaurant in DMCC" });
      expect(res.intent.searchIntents).toContain("LICENCE_SEARCH");
      expect(res.intent.jurisdictionSlug).toBe("dmcc");
      expect(res.results[0].matchType).toBe("exact");
    });

    it("B7 'can I open a food business unit'", async () => {
      setupDbMock([makeCandidate({ officialName: "Foodstuff Trading", normalizedName: "foodstuff trading" })]);
      const res = await searchUnified({ q: "can I open a food business unit" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });

    it("B8 'interested in property brokerage'", async () => {
      setupDbMock([makeCandidate({ officialName: "Real Estate Brokerage", normalizedName: "real estate brokerage" })]);
      const res = await searchUnified({ q: "interested in property brokerage" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });
  });

  // =====================================================================
  // (C) TYPO TOLERANCE
  // =====================================================================
  describe("C: typo tolerance", () => {
    it.each([
      ["jewlery trading", "Jewellery Trading"],
      ["restarant", "Restaurant"],
      ["accountng firm", "Accounting Firm"],
      ["logistcs company", "Logistics Company"],
      ["medcial clinic", "Medical Clinic"],
      ["clininc", "Clinic"],
      ["marketng services", "Marketing Services"],
      ["sotware development", "Software Development"],
      ["warehousng services", "Warehousing Services"],
      ["accountng and bookkeeping", "Accounting and Bookkeeping"],
    ])("C: '%s' finds '%s'", async (q, officialName) => {
      setupDbMock([makeCandidate({ officialName, normalizedName: officialName.toLowerCase() })]);
      const res = await searchUnified({ q });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].activity.officialName).toBe(officialName);
      expect(res.intent.typoCorrected).toBe(true);
    });
  });

  // =====================================================================
  // (D) ACTIVITY MATCHING HIERARCHY
  // =====================================================================
  describe("D: matching hierarchy", () => {
    it("D1 exact name match scores 1.0", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res.results[0].matchType).toBe("exact");
      expect(res.results[0].matchScore).toBe(1.0);
    });

    it("D2 exact activity code match", async () => {
      setupDbMock([makeCandidate({ officialName: "Kitchen Equipment Trading", normalizedName: "kitchen equipment trading", activityCode: "abc123" })]);
      const res = await searchUnified({ q: "abc123" });
      expect(res.results[0].matchType).toBe("exact");
      expect(res.results[0].matchScore).toBe(0.98);
    });

    it("D3 multi-term strong match 'online electronics store'", async () => {
      setupDbMock([makeCandidate({ officialName: "Online Electronics Trading", normalizedName: "online electronics trading" })]);
      const res = await searchUnified({ q: "online electronics store" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].matchType).toBe("strong");
    });

    it("D4 intent-tier match 'food business' -> 'Foodstuff Trading'", async () => {
      setupDbMock([makeCandidate({ officialName: "Foodstuff Trading", normalizedName: "foodstuff trading" })]);
      const res = await searchUnified({ q: "food business" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });

    it("D5 synonym-driven strong match 'accounting' -> 'Accounting and Bookkeeping'", async () => {
      setupDbMock([makeCandidate({ officialName: "Accounting and Bookkeeping", normalizedName: "accounting and bookkeeping" })]);
      const res = await searchUnified({ q: "accounting" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });

    it("D6 high-confidence phrase 'digital marketing agency'", async () => {
      setupDbMock([makeCandidate({ officialName: "Digital Marketing Agency", normalizedName: "digital marketing agency" })]);
      const res = await searchUnified({ q: "digital marketing agency" });
      expect(res.results[0].matchType).toBe("exact");
      expect(res.results[0].matchScore).toBe(1.0);
    });

    it("D7 unrelated query yields no results", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "xxqqkkwm" });
      expect(res.total).toBe(0);
    });
  });

  // =====================================================================
  // (E) NEGATIVE RELEVANCE
  // =====================================================================
  describe("E: negative relevance", () => {
    it("E1 'restaurant' ranks pure Restaurant exact above equipment-trading RELATED", async () => {
      setupDbMock([
        makeCandidate({ id: "e1a", officialName: "Restaurant", normalizedName: "restaurant" }),
        makeCandidate({ id: "e1b", officialName: "Restaurant Equipment Trading", normalizedName: "restaurant equipment trading" }),
      ]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res.total).toBeGreaterThanOrEqual(2);
      expect(res.results[0].activity.officialName).toBe("Restaurant");
      const equipment = res.results.find((r) => r.activity.officialName === "Restaurant Equipment Trading");
      expect(equipment).toBeDefined();
      expect(equipment!.matchType).toBe("related");
      expect(equipment!.matchScore).toBeLessThanOrEqual(0.72);
    });

    it("E2 'medical clinic' excludes medical gas trading", async () => {
      setupDbMock([
        makeCandidate({ id: "e2a", officialName: "Medical Clinic", normalizedName: "medical clinic" }),
        makeCandidate({ id: "e2b", officialName: "Medical Gas Trading", normalizedName: "medical gas trading" }),
      ]);
      const res = await searchUnified({ q: "medical clinic" });
      expect(res.results.some((r) => r.activity.officialName === "Medical Clinic")).toBe(true);
      expect(res.results.some((r) => r.activity.officialName === "Medical Gas Trading")).toBe(false);
    });

    it("E3 'petrol station' equipment activity is capped to RELATED", async () => {
      setupDbMock([makeCandidate({ officialName: "Petrol Station Equipment Trading", normalizedName: "petrol station equipment trading" })]);
      const res = await searchUnified({ q: "petrol station" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].matchType).toBe("related");
      expect(res.results[0].matchScore).toBeLessThanOrEqual(0.72);
    });

    it("E4 'trading company' is exact only for a literal name; otherwise RELATED", async () => {
      setupDbMock([
        makeCandidate({ id: "e4a", officialName: "Trading Company", normalizedName: "trading company" }),
        makeCandidate({ id: "e4b", officialName: "General Trading Company", normalizedName: "general trading company" }),
      ]);
      const res = await searchUnified({ q: "trading company" });
      expect(res.total).toBeGreaterThanOrEqual(2);
      expect(res.results[0].activity.officialName).toBe("Trading Company");
      expect(res.results[0].matchType).toBe("exact");
      const generic = res.results.find((r) => r.activity.officialName === "General Trading Company");
      expect(generic).toBeDefined();
      expect(generic!.matchType).toBe("related");
      expect(generic!.matchScore).toBeLessThanOrEqual(0.72);
    });

    it("E5 'dental clinic' does not surface medical clinic as a strong match", async () => {
      setupDbMock([
        makeCandidate({ id: "e5a", officialName: "Dental Clinic", normalizedName: "dental clinic" }),
        makeCandidate({ id: "e5b", officialName: "Medical Clinic", normalizedName: "medical clinic" }),
      ]);
      const res = await searchUnified({ q: "dental clinic" });
      expect(res.results.some((r) => r.activity.officialName === "Dental Clinic")).toBe(true);
      const medical = res.results.find((r) => r.activity.officialName === "Medical Clinic");
      if (medical) {
        expect(medical.matchType).not.toBe("exact");
        expect(medical.matchType).not.toBe("strong");
      }
    });

    it("E6 'restaurant' excludes restaurant consultancy services", async () => {
      setupDbMock([
        makeCandidate({ id: "e6a", officialName: "Restaurant", normalizedName: "restaurant" }),
        makeCandidate({ id: "e6b", officialName: "Restaurant Consultation Services", normalizedName: "restaurant consultation services" }),
      ]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res.results.some((r) => r.activity.officialName === "Restaurant Consultation Services")).toBe(false);
    });
  });

  // =====================================================================
  // (F) RESULT EXPLANATIONS
  // =====================================================================
  describe("F: human-readable reasons", () => {
    it("F1 every result carries a readable match reason without raw weights", async () => {
      setupDbMock([
        makeCandidate({ id: "f1a", officialName: "Restaurant", normalizedName: "restaurant" }),
        makeCandidate({ id: "f1b", officialName: "Restaurant Equipment Trading", normalizedName: "restaurant equipment trading" }),
      ]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res.results.length).toBeGreaterThanOrEqual(1);
      for (const r of res.results) {
        expect(r.matchReasons.length).toBeGreaterThan(0);
        for (const reason of r.matchReasons) {
          expect(reason).not.toMatch(/\(weight:\s*\d/);
          expect(reason).not.toMatch(/weight:\s*0\.\d/);
          expect(reason.length).toBeGreaterThan(10);
        }
      }
    });

    it("F2 reasons explain the match context", async () => {
      setupDbMock([makeCandidate({ officialName: "Jewellery Trading", normalizedName: "jewellery trading" })]);
      const res = await searchUnified({ q: "jewellery trading" });
      expect(res.results[0].matchReasons.join(" ")).toContain("Jewellery Trading");
    });
  });

  // =====================================================================
  // (G) SEARCH INTENT CLASSIFICATION
  // =====================================================================
  describe("G: intent classification", () => {
    it("G1 fee + licence intent with jurisdiction", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "ifza", jurisdictionSlug: "ifza" })], ALL_ZONES);
      const res = await searchUnified({ q: "how much is the licence fee for a restaurant in IFZA" });
      expect(res.intent.searchIntents).toContain("FEE_SEARCH");
      expect(res.intent.searchIntents).toContain("LICENCE_SEARCH");
      expect(res.intent.jurisdictionSlug).toBe("ifza");
    });

    it("G2 approval intent", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "do I need an approval to open a restaurant" });
      expect(res.intent.searchIntents).toContain("APPROVAL_SEARCH");
    });

    it("G3 jurisdiction browse is honest (0 fabricated results)", async () => {
      setupDbMock([], ALL_ZONES);
      const res = await searchUnified({ q: "what activities are available in DMCC" });
      expect(res.intent.searchIntents).toContain("JURISDICTION_SEARCH");
      expect(res.intent.jurisdictionSlug).toBe("dmcc");
      expect(res.total).toBe(0);
    });

    it("G4 comparison intent", async () => {
      setupDbMock(
        [makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "rakez", jurisdictionSlug: "rakez" })],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "compare RAKEZ and DMCC restaurant activities" });
      expect(res.intent.searchIntents).toContain("COMPARISON_INTENT");
      expect(res.intent.jurisdictionSlug).toBe("rakez");
      expect(res.total).toBeGreaterThanOrEqual(1);
    });

    it("G5 'what can I do in IFZA' is a jurisdiction search", async () => {
      setupDbMock([], ALL_ZONES);
      const res = await searchUnified({ q: "what can I do in IFZA" });
      expect(res.intent.searchIntents).toContain("JURISDICTION_SEARCH");
      expect(res.intent.jurisdictionSlug).toBe("ifza");
    });

    it("G6 'restaurant permit in spc' is a licence search", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "restaurant permit in spc" });
      expect(res.intent.searchIntents).toContain("LICENCE_SEARCH");
      expect(res.intent.jurisdictionSlug).toBe("spc");
    });

    it("G7 'how much does a restaurant cost in Ajman' is a fee search", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "how much does a restaurant cost in Ajman" });
      expect(res.intent.searchIntents).toContain("FEE_SEARCH");
      expect(res.intent.jurisdictionSlug).toBe("afz");
    });

    it("G8 plain query is an activity search only", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "restaurant" });
      expect(res.intent.searchIntents).toEqual(["ACTIVITY_SEARCH"]);
    });
  });

  // =====================================================================
  // (H) EMPTY RESULTS / GENERIC QUERIES
  // =====================================================================
  describe("H: empty results and generic queries", () => {
    it("H1 intent-only query returns no invented results", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "how much does this approval cost" });
      expect(res.total).toBe(0);
      expect(res.intent.searchIntents).toContain("FEE_SEARCH");
    });

    it("H2 filler-only query returns nothing", async () => {
      const res = await searchUnified({ q: "please help" });
      expect(res.total).toBe(0);
    });

    it("H3 gibberish returns nothing", async () => {
      const res = await searchUnified({ q: "zzzzqq" });
      expect(res.total).toBe(0);
    });

    it("H4 single-letter tokens return nothing", async () => {
      const res = await searchUnified({ q: "a b c d" });
      expect(res.total).toBe(0);
    });

    it("H5 generic 'trading' is marked generic and stays RELATED", async () => {
      setupDbMock([makeCandidate({ officialName: "General Trading", normalizedName: "general trading" })]);
      const res = await searchUnified({ q: "trading" });
      expect(res.intent.isGenericQuery).toBe(true);
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].matchType).toBe("related");
    });

    it("H6 generic 'consultancy' stays RELATED", async () => {
      setupDbMock([makeCandidate({ officialName: "Management Consultancy", normalizedName: "management consultancy" })]);
      const res = await searchUnified({ q: "consultancy" });
      expect(res.intent.isGenericQuery).toBe(true);
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].matchType).toBe("related");
    });
  });

  // =====================================================================
  // (I) WORD VARIANTS / STEMMING
  // =====================================================================
  describe("I: word variants", () => {
    it("I1 'coffee shop' matches the exact official activity", async () => {
      setupDbMock([makeCandidate({ officialName: "Coffee Shop", normalizedName: "coffee shop" })]);
      const res = await searchUnified({ q: "coffee shop" });
      expect(res.results[0].matchType).toBe("exact");
    });

    it("I2 store/shop variant bridges 'shoe store' -> 'Shoe Shop'", async () => {
      setupDbMock([makeCandidate({ officialName: "Shoe Shop", normalizedName: "shoe shop" })]);
      const res = await searchUnified({ q: "shoe store" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });

    it("I3 organisation/organization variant", async () => {
      setupDbMock([makeCandidate({ officialName: "Training Organization", normalizedName: "training organization" })]);
      const res = await searchUnified({ q: "training organisation" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong", "related"]).toContain(res.results[0].matchType);
    });

    it("I4 'restaurant licence' keeps licence intent and matches the restaurant", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant License", normalizedName: "restaurant license" })]);
      const res = await searchUnified({ q: "restaurant licence" });
      expect(res.intent.searchIntents).toContain("LICENCE_SEARCH");
      expect(res.total).toBeGreaterThanOrEqual(1);
    });

    it("I5 ecommerce/e-commerce variant", async () => {
      setupDbMock([makeCandidate({ officialName: "E-Commerce Services", normalizedName: "e-commerce services" })]);
      const res = await searchUnified({ q: "ecommerce business" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });
  });

  // =====================================================================
  // (J) PER-JURISDICTION AVAILABILITY
  // =====================================================================
  describe("J: availability across jurisdictions", () => {
    it("J1 match in DMCC, no_match elsewhere", async () => {
      setupDbMock(
        [makeCandidate({ id: "j1", officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "dmcc", jurisdictionSlug: "dmcc" })],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "restaurant" });
      expect(res.availability.matchedJurisdictionSlugs).toEqual(["dmcc"]);
      expect(res.availability.unmatched.map((j) => j.slug)).toEqual(
        expect.arrayContaining(["rakez", "spc", "afz", "ifza"]),
      );
      expect(res.jurisdictionGroups.filter((g) => g.status === "no_match").length).toBe(4);
    });

    it("J2 jurisdiction-scoped search limits availability reporting", async () => {
      setupDbMock(
        [makeCandidate({ id: "j2", officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "ifza", jurisdictionSlug: "ifza" })],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "restaurant in IFZA" });
      expect(res.results.every((r) => r.jurisdiction.slug === "ifza")).toBe(true);
      expect(res.availability.matchedJurisdictionSlugs).toEqual(["ifza"]);
    });
  });

  // =====================================================================
  // (K) COMMERCIAL PHRASINGS / ACTIVITY CONCEPTS
  // =====================================================================
  describe("K: commercial phrasings", () => {
    it("K1 'online clothing store'", async () => {
      setupDbMock([makeCandidate({ officialName: "Clothing Trading", normalizedName: "clothing trading" })]);
      const res = await searchUnified({ q: "online clothing store" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });

    it("K2 'womens clothing shop'", async () => {
      setupDbMock([makeCandidate({ officialName: "Garments Trading", normalizedName: "garments trading" })]);
      const res = await searchUnified({ q: "womens clothing shop" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });

    it("K3 'jewellery store'", async () => {
      setupDbMock([makeCandidate({ officialName: "Gold and Jewellery Trading", normalizedName: "gold and jewellery trading" })]);
      const res = await searchUnified({ q: "jewellery store" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });

    it("K4 'car rental'", async () => {
      setupDbMock([makeCandidate({ officialName: "Car Rental Services", normalizedName: "car rental services" })]);
      const res = await searchUnified({ q: "car rental" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });

    it("K5 'training institute'", async () => {
      setupDbMock([makeCandidate({ officialName: "Training Institute", normalizedName: "training institute" })]);
      const res = await searchUnified({ q: "training institute" });
      expect(res.results[0].matchType).toBe("exact");
    });

    it("K6 'import electronics'", async () => {
      setupDbMock([makeCandidate({ officialName: "Electronics Trading", normalizedName: "electronics trading" })]);
      const res = await searchUnified({ q: "import electronics" });
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(["exact", "strong"]).toContain(res.results[0].matchType);
    });

    it("K7 'marketing agency'", async () => {
      setupDbMock([makeCandidate({ officialName: "Marketing Agency", normalizedName: "marketing agency" })]);
      const res = await searchUnified({ q: "marketing agency" });
      expect(res.results[0].matchType).toBe("exact");
    });

    it("K8 'food franchise' surfaces a restaurant-related activity", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "food franchise" });
      expect(res.total).toBeGreaterThanOrEqual(1);
    });

    it("K9 'beauty salon'", async () => {
      setupDbMock([makeCandidate({ officialName: "Beauty Salon", normalizedName: "beauty salon" })]);
      const res = await searchUnified({ q: "beauty salon" });
      expect(res.results[0].matchType).toBe("exact");
    });
  });

  // =====================================================================
  // (L) EDGE CASES
  // =====================================================================
  describe("L: edge cases", () => {
    it("L1 numeric activity codes silently return nothing fabricated", async () => {
      setupDbMock([makeCandidate({ officialName: "Kitchen Equipment Trading", normalizedName: "kitchen equipment trading" })]);
      const res = await searchUnified({ q: "6123 1134" });
      expect(res.total).toBe(0);
    });

    it("L2 punctuation is handled ('restaurant!')", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "restaurant!" });
      expect(res.results[0].matchType).toBe("exact");
    });

    it("L3 impossible 'nuclear power plant' returns nothing", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "nuclear power plant" });
      expect(res.total).toBe(0);
    });

    it("L4 impossible 'space tourism' returns nothing", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "space tourism" });
      expect(res.total).toBe(0);
    });

    it("L5 very long noise query does not crash", async () => {
      setupDbMock([makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant" })]);
      const res = await searchUnified({ q: "asdf ".repeat(50) });
      expect(typeof res.total).toBe("number");
    });

    it("L6 realistic mixed natural language + jurisdiction + intent", async () => {
      setupDbMock(
        [makeCandidate({ officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "rakez", jurisdictionSlug: "rakez", jurisdictionName: "RAKEZ" })],
        ALL_ZONES,
      );
      const res = await searchUnified({ q: "I'm looking to open a restaurant in RAKEZ, what approvals do I need" });
      expect(res.intent.jurisdictionSlug).toBe("rakez");
      expect(res.intent.searchIntents).toContain("ACTIVITY_SEARCH");
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.results[0].jurisdiction.slug).toBe("rakez");
    });

    it("L7 candidates deduplicated across retrieval tiers", async () => {
      setupDbMock([
        makeCandidate({ id: "l7a", officialName: "Restaurant", normalizedName: "restaurant" }),
        makeCandidate({ id: "l7b", officialName: "Restaurant Equipment Trading", normalizedName: "restaurant equipment trading" }),
      ]);
      const res = await searchUnified({ q: "restaurant" });
      const names = resNames(res);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
      expect(names).toContain("Restaurant");
    });
  });
});