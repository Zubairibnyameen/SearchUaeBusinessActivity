import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for search pagination.
 *
 * The bug: `searchUnified()` filled `jurisdictionGroups[].topResults` from EVERY
 * ranked match while ignoring `offset`/`limit`, and the `/search` page renders
 * `topResults`. `results` — the actual page — was only consulted for the page-1
 * empty check, so every page rendered the same top hits while the pager
 * advertised the full match count.
 *
 * These tests pin the contract the fix establishes:
 *   - the grouped view is a partition of the requested page;
 *   - different pages yield different activities;
 *   - `total` and per-jurisdiction counts describe the whole match set and stay
 *     page-independent;
 *   - out-of-range pages are empty rather than a repeat of page 1.
 */

const { dbMock } = vi.hoisted(() => ({
  dbMock: { select: vi.fn(), selectDistinct: vi.fn(), execute: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { searchUnified } from "@/lib/search/engine";
import type { JurisdictionGroup, SearchResultItem } from "@/lib/search/types";

// ─── Harness (mirrors the shape the engine's single UNION produces) ──────────

interface CandidateSpec {
  id: string;
  officialName: string;
  normalizedName: string;
  jurisdictionId: string;
  jurisdictionSlug: string;
  jurisdictionName: string;
  emirate?: string;
  jurisdictionType?: string;
  approvalSignal?: string;
  activityCode?: string | null;
}

function makeCandidate(spec: CandidateSpec) {
  return {
    activity: {
      id: spec.id,
      officialName: spec.officialName,
      normalizedName: spec.normalizedName,
      activityCode: spec.activityCode ?? null,
      description: null,
      officialCategory: "Food",
      activityGroup: "Food",
      jurisdictionId: spec.jurisdictionId,
      licenceTypeId: null,
      approvalSignal: spec.approvalSignal ?? "no_signal",
      approvalStatus: "unknown",
      verificationStatus: "unverified",
      lastVerified: null,
    },
    jurisdiction: {
      id: spec.jurisdictionId,
      name: spec.jurisdictionName,
      slug: spec.jurisdictionSlug,
      emirate: spec.emirate ?? "dubai",
      jurisdictionType: spec.jurisdictionType ?? "free_zone",
    },
    licenceType: null,
    source: null,
  };
}

function toFlatCandidate(c: ReturnType<typeof makeCandidate>) {
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
    lt_id: null,
    lt_name: null,
    lt_code: null,
    s_id: null,
    s_url: null,
    s_title: null,
    s_last_verified: null,
  };
}

interface JurisdictionSpec {
  id: string;
  slug: string;
  name: string;
  emirate?: string;
}

function toFlatAvailabilityRow(j: JurisdictionSpec) {
  return {
    a_id: null,
    a_official_name: null,
    a_normalized_name: null,
    a_activity_code: null,
    a_description: null,
    a_official_category: null,
    a_activity_group: null,
    a_approval_signal: null,
    a_approval_status: null,
    a_verification_status: null,
    a_last_verified: null,
    j_id: j.id,
    j_name: j.name,
    j_slug: j.slug,
    j_emirate: j.emirate ?? "dubai",
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

function setupDbMock(candidates: CandidateSpec[], jurisdictions?: JurisdictionSpec[]) {
  dbMock.execute.mockReset();
  const jRows = jurisdictions ?? [{ id: "jur-1", slug: "dmcc", name: "DMCC" }];
  dbMock.execute.mockImplementation(() =>
    Promise.resolve([
      ...candidates.map(c => toFlatCandidate(makeCandidate(c))),
      ...jRows.map(toFlatAvailabilityRow),
    ])
  );
}

/** Ids of every result the grouped view would actually render. */
function renderedIds(groups: JurisdictionGroup[]): string[] {
  return groups.flatMap(g => g.topResults.map(r => r.activity.id));
}

function ids(items: SearchResultItem[]): string[] {
  return items.map(r => r.activity.id);
}

/**
 * `count` activities in a single jurisdiction, named so the engine's relevance
 * ranking is unambiguous (exact name match on the query).
 */
function singleJurisdictionMatches(count: number): CandidateSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `act-${String(i).padStart(2, "0")}`,
    officialName: `Restaurant ${i}`,
    normalizedName: `restaurant ${i}`,
    jurisdictionId: "jur-1",
    jurisdictionSlug: "dmcc",
    jurisdictionName: "DMCC",
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchUnified pagination", () => {
  // ── 1. Different pages must contain different results ─────────────────────
  it("page 1 and page 2 return disjoint result sets", async () => {
    setupDbMock(singleJurisdictionMatches(10));

    const page1 = await searchUnified({ q: "restaurant", limit: 5, offset: 0 });
    const page2 = await searchUnified({ q: "restaurant", limit: 5, offset: 5 });

    expect(page1.results).toHaveLength(5);
    expect(page2.results).toHaveLength(5);
    expect(ids(page1.results)).not.toEqual(ids(page2.results));

    const overlap = ids(page1.results).filter(id => ids(page2.results).includes(id));
    expect(overlap).toEqual([]);
  });

  it("the grouped view differs between pages, not just the flat array", async () => {
    setupDbMock(singleJurisdictionMatches(10));

    const page1 = await searchUnified({ q: "restaurant", limit: 5, offset: 0 });
    const page2 = await searchUnified({ q: "restaurant", limit: 5, offset: 5 });

    const rendered1 = renderedIds(page1.jurisdictionGroups);
    const rendered2 = renderedIds(page2.jurisdictionGroups);

    expect(rendered1).toHaveLength(5);
    expect(rendered2).toHaveLength(5);
    expect(rendered1).not.toEqual(rendered2);
    expect(rendered1.filter(id => rendered2.includes(id))).toEqual([]);
  });

  it("pages walk the ranked list in order, with no gaps or repeats", async () => {
    setupDbMock(singleJurisdictionMatches(12));

    const first = await searchUnified({ q: "restaurant", limit: 5, offset: 0 });
    const second = await searchUnified({ q: "restaurant", limit: 5, offset: 5 });
    const third = await searchUnified({ q: "restaurant", limit: 5, offset: 10 });

    const paged = [...ids(first.results), ...ids(second.results), ...ids(third.results)];
    const flat = ids((await searchUnified({ q: "restaurant", limit: 100 })).results);

    expect(new Set(paged).size).toBe(12);
    expect(paged).toEqual(flat);
  });

  it("is deterministic — identical requests produce identical pages", async () => {
    setupDbMock(singleJurisdictionMatches(10));

    const a = await searchUnified({ q: "restaurant", limit: 4, offset: 4 });
    const b = await searchUnified({ q: "restaurant", limit: 4, offset: 4 });

    expect(ids(a.results)).toEqual(ids(b.results));
    expect(renderedIds(a.jurisdictionGroups)).toEqual(renderedIds(b.jurisdictionGroups));
  });

  // ── 2. Page boundaries ────────────────────────────────────────────────────
  it("a page starting exactly at the end of the match set is empty", async () => {
    setupDbMock(singleJurisdictionMatches(10));

    const lastFull = await searchUnified({ q: "restaurant", limit: 10, offset: 0 });
    expect(lastFull.results).toHaveLength(10);

    const past = await searchUnified({ q: "restaurant", limit: 10, offset: 10 });
    expect(past.results).toHaveLength(0);
    expect(renderedIds(past.jurisdictionGroups)).toEqual([]);
  });

  it("a partial final page returns only the remainder", async () => {
    setupDbMock(singleJurisdictionMatches(7));

    const full = await searchUnified({ q: "restaurant", limit: 5, offset: 0 });
    const tail = await searchUnified({ q: "restaurant", limit: 5, offset: 5 });

    expect(full.results).toHaveLength(5);
    expect(tail.results).toHaveLength(2);
    expect(renderedIds(tail.jurisdictionGroups)).toHaveLength(2);
  });

  it("an offset beyond the match set yields an empty page, never a repeat of page 1", async () => {
    setupDbMock(singleJurisdictionMatches(6));

    const page1 = await searchUnified({ q: "restaurant", limit: 3, offset: 0 });
    const wayOut = await searchUnified({ q: "restaurant", limit: 3, offset: 999 });

    expect(page1.results).toHaveLength(3);
    expect(wayOut.results).toHaveLength(0);
    expect(renderedIds(wayOut.jurisdictionGroups)).toEqual([]);
  });

  // ── 3. Total count stays correct and page-independent ─────────────────────
  it("total describes the whole match set on every page", async () => {
    setupDbMock(singleJurisdictionMatches(10));

    const page1 = await searchUnified({ q: "restaurant", limit: 3, offset: 0 });
    const page2 = await searchUnified({ q: "restaurant", limit: 3, offset: 3 });
    const page4 = await searchUnified({ q: "restaurant", limit: 3, offset: 9 });

    expect(page1.total).toBe(10);
    expect(page2.total).toBe(10);
    expect(page4.total).toBe(10);
  });

  it("total is unaffected by limit and offset", async () => {
    setupDbMock(singleJurisdictionMatches(9));

    for (const opts of [
      { limit: 1, offset: 0 },
      { limit: 4, offset: 4 },
      { limit: 100, offset: 0 },
    ]) {
      const res = await searchUnified({ q: "restaurant", ...opts });
      expect(res.total).toBe(9);
    }
  });

  // ── 4. Empty pages ────────────────────────────────────────────────────────
  it("no matches at all gives an empty page and no rendered groups", async () => {
    setupDbMock([]);

    const res = await searchUnified({ q: "restaurant", limit: 10, offset: 0 });

    expect(res.total).toBe(0);
    expect(res.results).toEqual([]);
    expect(res.jurisdictionGroups.every(g => g.topResults.length === 0)).toBe(true);
    expect(res.availability.matchedJurisdictionSlugs).toEqual([]);
  });

  it("a jurisdiction with no matches still reports no_match, not an empty match group", async () => {
    setupDbMock(singleJurisdictionMatches(3), [
      { id: "jur-1", slug: "dmcc", name: "DMCC" },
      { id: "jur-2", slug: "adgm", name: "ADGM" },
    ]);

    const res = await searchUnified({ q: "restaurant", limit: 10, offset: 0 });
    const adgm = res.jurisdictionGroups.find(g => g.jurisdiction.slug === "adgm");

    expect(adgm?.status).toBe("no_match");
    expect(adgm?.totalMatches).toBe(0);
    expect(adgm?.topResults).toEqual([]);
    expect(res.availability.unmatched.map(j => j.slug)).toContain("adgm");
  });

  // ── 5. Grouping stays correct ─────────────────────────────────────────────
  it("grouped view is a partition of the flat page — same ids, no duplicates", async () => {
    setupDbMock(singleJurisdictionMatches(9));

    for (const offset of [0, 4, 8]) {
      const res = await searchUnified({ q: "restaurant", limit: 4, offset });
      const flat = ids(res.results);
      const rendered = renderedIds(res.jurisdictionGroups);

      expect([...rendered].sort()).toEqual([...flat].sort());
      expect(new Set(rendered).size).toBe(rendered.length);
    }
  });

  it("splits a page across jurisdictions and keeps each group on its own jurisdiction", async () => {
    // Ranking is pinned by score, not by fixture order: an exact name match
    // (1.0) always outranks a "Restaurant Services" strong match, so DMCC is
    // first and ADGM second on every run.
    setupDbMock(
      [
        { id: "dmcc-1", officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "jur-1", jurisdictionSlug: "dmcc", jurisdictionName: "DMCC" },
        { id: "adgm-1", officialName: "Restaurant Services", normalizedName: "restaurant services", jurisdictionId: "jur-2", jurisdictionSlug: "adgm", jurisdictionName: "ADGM" },
      ],
      [
        { id: "jur-1", slug: "dmcc", name: "DMCC" },
        { id: "jur-2", slug: "adgm", name: "ADGM" },
      ]
    );

    const res = await searchUnified({ q: "restaurant", limit: 2, offset: 0, groupLimit: 8 });

    const dmcc = res.jurisdictionGroups.find(g => g.jurisdiction.slug === "dmcc");
    const adgm = res.jurisdictionGroups.find(g => g.jurisdiction.slug === "adgm");

    expect(dmcc?.topResults.length).toBeGreaterThan(0);
    expect(adgm?.topResults.length).toBeGreaterThan(0);
    expect(dmcc?.topResults.every(r => r.jurisdiction.slug === "dmcc")).toBe(true);
    expect(adgm?.topResults.every(r => r.jurisdiction.slug === "adgm")).toBe(true);
    expect(renderedIds(res.jurisdictionGroups)).toHaveLength(2);
  });

  it("totalMatches counts the whole match set, so it does not shrink as you page", async () => {
    // Three exact DMCC matches (score 1.0) rank above the single ADGM strong
    // match, so both pages below land on DMCC and its slice is exactly one item.
    setupDbMock(
      [
        { id: "dmcc-1", officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "jur-1", jurisdictionSlug: "dmcc", jurisdictionName: "DMCC" },
        { id: "dmcc-2", officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "jur-1", jurisdictionSlug: "dmcc", jurisdictionName: "DMCC" },
        { id: "dmcc-3", officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "jur-1", jurisdictionSlug: "dmcc", jurisdictionName: "DMCC" },
        { id: "adgm-1", officialName: "Restaurant Services", normalizedName: "restaurant services", jurisdictionId: "jur-2", jurisdictionSlug: "adgm", jurisdictionName: "ADGM" },
      ],
      [
        { id: "jur-1", slug: "dmcc", name: "DMCC" },
        { id: "jur-2", slug: "adgm", name: "ADGM" },
      ]
    );

    const page1 = await searchUnified({ q: "restaurant", limit: 1, offset: 0 });
    const page3 = await searchUnified({ q: "restaurant", limit: 1, offset: 2 });

    const dmcc1 = page1.jurisdictionGroups.find(g => g.jurisdiction.slug === "dmcc");
    const dmcc3 = page3.jurisdictionGroups.find(g => g.jurisdiction.slug === "dmcc");

    // Three DMCC matches exist overall, so the count is 3 on both pages...
    expect(dmcc1?.totalMatches).toBe(3);
    expect(dmcc3?.totalMatches).toBe(3);
    // ...while the rendered slice is exactly the page's single result.
    expect(dmcc1?.topResults).toHaveLength(1);
    expect(dmcc3?.topResults).toHaveLength(1);
    expect(dmcc1?.topResults[0].activity.id).not.toBe(dmcc3?.topResults[0].activity.id);
  });

  it("a matched jurisdiction whose matches all rank on other pages stays match with an empty slice", async () => {
    // ADGM's only match ranks last, so a one-item page can never contain it.
    setupDbMock(
      [
        { id: "dmcc-1", officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "jur-1", jurisdictionSlug: "dmcc", jurisdictionName: "DMCC" },
        { id: "dmcc-2", officialName: "Restaurant", normalizedName: "restaurant", jurisdictionId: "jur-1", jurisdictionSlug: "dmcc", jurisdictionName: "DMCC" },
        { id: "adgm-1", officialName: "Restaurant Services", normalizedName: "restaurant services", jurisdictionId: "jur-2", jurisdictionSlug: "adgm", jurisdictionName: "ADGM" },
      ],
      [
        { id: "jur-1", slug: "dmcc", name: "DMCC" },
        { id: "jur-2", slug: "adgm", name: "ADGM" },
      ]
    );

    const all = await searchUnified({ q: "restaurant", limit: 10 });
    expect(all.total).toBe(3);
    expect(all.availability.matchedJurisdictionSlugs).toContain("adgm");

    const page1 = await searchUnified({ q: "restaurant", limit: 1, offset: 0 });
    const adgm = page1.jurisdictionGroups.find(g => g.jurisdiction.slug === "adgm");

    // Availability is global, so ADGM is still a match with a truthful count and
    // a best-match type — it just has nothing to render on THIS page. It must
    // never be demoted to no_match, and must never borrow another jurisdiction's
    // results.
    expect(adgm?.status).toBe("match");
    expect(adgm?.totalMatches).toBe(1);
    expect(adgm?.bestMatchType).not.toBeNull();
    expect(adgm?.topResults).toEqual([]);
    expect(page1.jurisdictionGroups.filter(g => g.status === "no_match")).toEqual([]);

    // The page itself still renders only its own single result.
    expect(renderedIds(page1.jurisdictionGroups)).toEqual(["dmcc-1"]);
  });

  it("groupLimit still caps a group without affecting the flat page", async () => {
    setupDbMock(singleJurisdictionMatches(8));

    const res = await searchUnified({ q: "restaurant", limit: 8, offset: 0, groupLimit: 3 });

    expect(res.results).toHaveLength(8);
    const dmcc = res.jurisdictionGroups.find(g => g.jurisdiction.slug === "dmcc");
    expect(dmcc?.topResults).toHaveLength(3);
    expect(dmcc?.totalMatches).toBe(8);
  });

  it("does not mutate the pipeline result — repeated pages stay stable", async () => {
    setupDbMock(singleJurisdictionMatches(8));

    const first = await searchUnified({ q: "restaurant", limit: 4, offset: 0 });
    const again = await searchUnified({ q: "restaurant", limit: 4, offset: 0 });
    const other = await searchUnified({ q: "restaurant", limit: 4, offset: 4 });

    expect(ids(again.results)).toEqual(ids(first.results));
    expect(renderedIds(again.jurisdictionGroups)).toEqual(renderedIds(first.jurisdictionGroups));
    expect(renderedIds(other.jurisdictionGroups)).not.toEqual(renderedIds(first.jurisdictionGroups));
  });
});

// ── allMatches: the opt-out used by grouped analysis (comparison, intelligence)

describe("searchUnified allMatches", () => {
  it("covers every match regardless of limit and offset", async () => {
    setupDbMock(singleJurisdictionMatches(10));

    const paged = await searchUnified({ q: "restaurant", limit: 3, offset: 6 });
    const all = await searchUnified({ q: "restaurant", allMatches: true, groupLimit: 4 });

    expect(paged.results).toHaveLength(3);
    expect(all.results).toHaveLength(10);
    expect(all.total).toBe(10);

    // Top N per jurisdiction across ALL matches — what jurisdiction comparison
    // needs, and what the pre-fix grouping produced for every page.
    const dmcc = all.jurisdictionGroups.find(g => g.jurisdiction.slug === "dmcc");
    expect(dmcc?.topResults).toHaveLength(4);
    expect(ids(dmcc!.topResults)).toEqual(ids(all.results).slice(0, 4));
  });

  it("still reports page-independent counts", async () => {
    setupDbMock(singleJurisdictionMatches(6));

    const all = await searchUnified({ q: "restaurant", allMatches: true, groupLimit: 2 });
    const dmcc = all.jurisdictionGroups.find(g => g.jurisdiction.slug === "dmcc");

    expect(dmcc?.totalMatches).toBe(6);
    expect(dmcc?.topResults).toHaveLength(2);
  });
});