import { describe, it, expect, vi, beforeEach } from "vitest";
import { correctKnownTypo, correctQueryTypos, parseQuery } from "@/lib/search/query-parser";

const { dbMock } = vi.hoisted(() => ({
  dbMock: { select: vi.fn(), selectDistinct: vi.fn(), execute: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { searchUnified } from "@/lib/search/engine";

/**
 * Regression cover for four relevance defects found by probing the real
 * database, each of which had a concrete, observable failure.
 *
 * The harness mirrors the flat alias shape of the engine's UNION ALL candidate
 * query, including `a_isic_code`.
 */
interface RowOverrides {
  id?: string;
  officialName?: string;
  normalizedName?: string;
  activityCode?: string | null;
  isicCode?: string | null;
  description?: string | null;
  officialCategory?: string | null;
  activityGroup?: string | null;
  jurisdictionName?: string;
  jurisdictionSlug?: string;
}

function makeRow(o: RowOverrides = {}) {
  const officialName = o.officialName ?? "General Trading";
  return {
    a_id: o.id ?? "act-1",
    a_official_name: officialName,
    a_normalized_name: o.normalizedName ?? officialName.toLowerCase(),
    a_activity_code: o.activityCode ?? null,
    a_isic_code: o.isicCode ?? null,
    a_description: o.description ?? null,
    a_official_category: o.officialCategory ?? null,
    a_activity_group: o.activityGroup ?? null,
    a_approval_signal: "no_signal",
    a_approval_status: "unknown",
    a_verification_status: "unverified",
    a_last_verified: null,
    j_id: "jur-1",
    j_name: o.jurisdictionName ?? "DMCC",
    j_slug: o.jurisdictionSlug ?? "dmcc",
    j_emirate: "dubai",
    j_jurisdiction_type: "free_zone",
    lt_id: null,
    lt_name: null,
    lt_code: null,
    s_id: null,
    s_url: null,
    s_title: null,
    s_last_verified: null,
  };
}

function setupDb(rows: RowOverrides[]) {
  dbMock.execute.mockReset();
  dbMock.execute.mockImplementation(() => Promise.resolve(rows.map(makeRow)));
}

describe("typo correction does not corrupt valid domain words", () => {
  it("leaves 'trade' alone instead of rewriting it to 'travel'", () => {
    // The distance metric reported 1 for trade/travel, so "general trade" was
    // corrected to "general travel" and every General Trading result vanished.
    expect(correctKnownTypo("trade")).toBe("trade");
    expect(correctQueryTypos("general trade")).toBe("general trade");
  });

  it("still corrects genuine typos of high-signal terms", () => {
    expect(correctKnownTypo("resturant")).toBe("restaurant");
    expect(correctKnownTypo("clinc")).toBe("clinic");
    expect(correctQueryTypos("resturant licence")).toBe("restaurant licence");
  });

  it("corrects a typo of 'general', the flagship activity term", () => {
    expect(correctKnownTypo("generl")).toBe("general");
    expect(correctQueryTypos("generl trading")).toBe("general trading");
  });

  it("never rewrites a correctly spelled domain word", () => {
    const mustNotChange = [
      "trade", "trading", "trader", "general", "restaurant", "clinic", "shop",
      "store", "license", "licence", "licensing", "business", "company",
      "travel", "training", "logistics", "wholesale", "retail", "medical",
      "hospital", "restaurant", "catering", "bakery", "consultancy", "consulting",
    ];
    for (const word of mustNotChange) {
      expect(correctKnownTypo(word)).toBe(word);
    }
  });

  it("keeps 'general trade' pointed at trading, not travel", () => {
    const parsed = parseQuery("general trade");
    expect(parsed.correctedQuery).toBe("general trade");
    expect(parsed.businessTerms).toContain("trade");
    expect(parsed.businessTerms).not.toContain("travel");
  });
});

describe("singular and plural queries reach the same activities", () => {
  beforeEach(() => setupDb([]));

  it("ranks the singular activity exact for the plural query", async () => {
    setupDb([
      { id: "a1", officialName: "Restaurant", normalizedName: "restaurant" },
      { id: "a2", officialName: "Floating Restaurant", normalizedName: "floating restaurant" },
    ]);
    const res = await searchUnified({ q: "restaurants", limit: 10 });
    expect(res.results[0].activity.officialName).toBe("Restaurant");
    expect(res.results[0].matchType).toBe("exact");
  });

  it("gives the plural query the same top hit as the singular", async () => {
    setupDb([
      { id: "a1", officialName: "Restaurant", normalizedName: "restaurant" },
      { id: "a2", officialName: "Floating Restaurant", normalizedName: "floating restaurant" },
    ]);
    const singular = await searchUnified({ q: "restaurant", limit: 10 });
    const plural = await searchUnified({ q: "restaurants", limit: 10 });
    expect(plural.results[0].activity.officialName).toBe(singular.results[0].activity.officialName);
    expect(plural.results[0].matchScore).toBe(singular.results[0].matchScore);
  });

  it("reaches clinic activities for the plural 'clinics'", async () => {
    setupDb([
      { id: "c1", officialName: "Cardiac Clinic", normalizedName: "cardiac clinic" },
      { id: "c2", officialName: "Automobile Repair", normalizedName: "automobile repair" },
    ]);
    const res = await searchUnified({ q: "clinics", limit: 10 });
    expect(res.results[0].activity.officialName).toBe("Cardiac Clinic");
  });

  it("reaches a singular-named activity for a plural query word", async () => {
    setupDb([
      { id: "s1", officialName: "Pet Shop", normalizedName: "pet shop" },
      { id: "s2", officialName: "Air Filters Manufacturing", normalizedName: "air filters manufacturing" },
    ]);
    const res = await searchUnified({ q: "shops", limit: 10 });
    expect(res.results[0].activity.officialName).toBe("Pet Shop");
  });

  it("does not shorten an -ss word into a shorter real word", async () => {
    // A naive singulariser turns "business" into "busine", but one that also
    // strips to "bus" would match "Bus Station". Only the ss/us/is guard
    // prevents that.
    setupDb([{ id: "s1", officialName: "Bus Station", normalizedName: "bus station" }]);
    const res = await searchUnified({ q: "business", limit: 10 });
    expect(res.total).toBe(0);
  });

  it("still treats an unrelated plural query as no match", async () => {
    setupDb([{ id: "x1", officialName: "Pet Shop", normalizedName: "pet shop" }]);
    const res = await searchUnified({ q: "widgets", limit: 10 });
    expect(res.total).toBe(0);
  });
});

describe("exact code matching survives punctuation", () => {
  beforeEach(() => setupDb([]));

  it("matches a hyphenated activity code", async () => {
    setupDb([
      { id: "k1", officialName: "Cream of Milk Manufacturing", normalizedName: "cream of milk manufacturing", activityCode: "1520-05" },
    ]);
    const res = await searchUnified({ q: "1520-05", limit: 10 });
    expect(res.results[0].activity.officialName).toBe("Cream of Milk Manufacturing");
    expect(res.results[0].matchScore).toBe(0.98);
  });

  it("matches a dotted activity code", async () => {
    setupDb([
      { id: "d1", officialName: "Support activities to agriculture", normalizedName: "support activities to agriculture", activityCode: "0160.00" },
    ]);
    const res = await searchUnified({ q: "0160.00", limit: 10 });
    expect(res.results[0].matchScore).toBe(0.98);
  });

  it("matches an alphanumeric activity code", async () => {
    setupDb([
      { id: "al1", officialName: "Kitchen Equipment Trading", normalizedName: "kitchen equipment trading", activityCode: "abc123" },
    ]);
    const res = await searchUnified({ q: "abc123", limit: 10 });
    expect(res.results[0].matchType).toBe("exact");
  });

  it("matches an ISIC classification code", async () => {
    // ISIC codes were selected but never searched, so every published
    // classification code returned nothing.
    setupDb([
      { id: "i1", officialName: "Silverware and Jewellery Manufacturing", normalizedName: "silverware and jewellery manufacturing", isicCode: "3211002" },
    ]);
    const res = await searchUnified({ q: "3211002", limit: 10 });
    expect(res.results[0].activity.officialName).toBe("Silverware and Jewellery Manufacturing");
    expect(res.results[0].matchScore).toBe(0.97);
  });

  it("scores an ISIC match just below an activity code match", async () => {
    setupDb([
      { id: "i1", officialName: "Tanker Manufacturing", normalizedName: "tanker manufacturing", isicCode: "2920103" },
    ]);
    const res = await searchUnified({ q: "2920103", limit: 10 });
    expect(res.results[0].matchType).toBe("exact");
    expect(res.results[0].matchScore).toBeLessThan(0.98);
  });

  it("does not match a code with its punctuation removed", async () => {
    // "152005" is a different code from "1520-05"; punctuation stays
    // significant.
    setupDb([
      { id: "k1", officialName: "Cream of Milk Manufacturing", normalizedName: "cream of milk manufacturing", activityCode: "1520-05" },
    ]);
    const res = await searchUnified({ q: "152005", limit: 10 });
    expect(res.total).toBe(0);
  });
});
