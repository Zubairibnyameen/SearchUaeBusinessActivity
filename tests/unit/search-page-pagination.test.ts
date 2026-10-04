import { describe, it, expect, vi, beforeEach } from "vitest";
import { authViewerMock, resetAuth, signInAsUser } from "../helpers/auth-mock";

/**
 * Component-level regression tests for `/search` pagination and enrichment.
 *
 * The reported bug was visible in this component, not just in the engine:
 * `SearchResults` renders `group.topResults` while enrichment had been keyed on
 * `data.results`, so paging never changed the rendered set and off-page cards
 * fell back to "Not verified/published in indexed official sources".
 *
 * These tests drive the real component with a stubbed engine and a real
 * enrichment map, so they pin the two together: what is drawn, and what each
 * drawn card is told about its own regulatory data.
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth/viewer", () => authViewerMock());

const { mockInsert, valuesImpl } = vi.hoisted(() => {
  const valuesImpl = vi.fn();
  return {
    valuesImpl,
    mockInsert: vi.fn(() => ({ values: valuesImpl })),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    insert: mockInsert,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })),
      })),
    })),
  },
}));

const mockSearchUnified = vi.fn();
vi.mock("@/lib/search/engine", () => ({
  searchUnified: (...args: unknown[]) => mockSearchUnified(...args),
}));

const mockEnrichResponse = vi.fn();
vi.mock("@/lib/search/enrichment", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/search/enrichment")>();
  return {
    collectRenderedActivityIds: actual.collectRenderedActivityIds,
    getRegulatorySummaries: actual.getRegulatorySummaries,
    enrichResponse: (...args: unknown[]) => mockEnrichResponse(...args),
  };
});

vi.mock("next/link", () => ({
  default: ({ children }: { children?: unknown }) => children,
}));

// The compare bar is a client component (useState). `tests/helpers/render.ts`
// invokes function components outside a React runtime, so hooks cannot run —
// it is stubbed here and covered by its own suite. Everything this suite cares
// about (pagination, sections, and what each result card is told about its own
// regulatory data) lives in the server components around it.
vi.mock("@/components/compare/search-compare-bar", () => ({
  SearchCompareBar: () => null,
}));

// The per-result share control is a client component. This harness walks the
// server tree and calls function components directly, which cannot run hooks, so
// it is stubbed out here - the button's own behaviour is covered in
// tests/unit/share-button.test.ts.
vi.mock("@/components/activities/share-button", () => ({
  ShareButton: () => null,
}));

import { SearchResults } from "@/components/search/search-results-list";
import { renderElement } from "../helpers/render";
import type { RegulatorySummary } from "@/lib/search/enrichment";
import type {
  JurisdictionGroup,
  SearchResultItem,
  UnifiedSearchResponse,
} from "@/lib/search/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PAGE_SIZE = 10;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeItem(id: string, jurisdictionSlug = "dmcc"): SearchResultItem {
  return {
    activity: {
      id,
      officialName: `Activity ${id}`,
      normalizedName: `activity ${id}`,
      activityCode: null,
      isicCode: null,
      description: null,
      officialCategory: null,
      activityGroup: null,
      approvalSignal: "no_signal",
      approvalStatus: "unknown",
      verificationStatus: "unverified",
      lastVerified: null,
    },
    jurisdiction: {
      id: `jur-${jurisdictionSlug}`,
      name: jurisdictionSlug.toUpperCase(),
      slug: jurisdictionSlug,
      emirate: "dubai",
      jurisdictionType: "free_zone",
    },
    licenceType: null,
    matchType: "exact",
    matchScore: 1,
    matchReasons: [],
    source: null,
  };
}

function makeGroup(slug: string, topResults: SearchResultItem[], totalMatches = topResults.length): JurisdictionGroup {
  return {
    jurisdiction: {
      id: `jur-${slug}`,
      slug,
      name: slug.toUpperCase(),
      emirate: "dubai",
      jurisdictionType: "free_zone",
    },
    status: "match",
    totalMatches,
    bestMatchType: "exact",
    topResults,
  };
}

function makeResponse(
  results: SearchResultItem[],
  groups: JurisdictionGroup[],
  total: number
): UnifiedSearchResponse {
  return {
    query: "restaurant",
    total,
    results,
    jurisdictionGroups: groups,
    availability: {
      matchedJurisdictionSlugs: groups.filter(g => g.status === "match").map(g => g.jurisdiction.slug),
      unmatched: [],
    },
    intent: {
      primaryNoun: "restaurant",
      industryDomain: "food",
      specificityLevel: "specific",
      isGenericQuery: false,
      searchIntents: ["ACTIVITY_SEARCH"],
      jurisdictionSlug: null,
      jurisdictionName: null,
      businessTerms: ["restaurant"],
      typoCorrected: false,
    },
    meta: { tookMs: 1, candidatesEvaluated: total, minRelevanceThreshold: 0.62 },
  };
}

const emptySummary = (): RegulatorySummary => ({
  verifiedApprovals: [],
  govFees: [],
  thirdPartyCosts: [],
});

/** One DMCC activity per page, all named so each is distinguishable in text. */
function dmccPage(ids: string[], total: number, totalMatches = ids.length): UnifiedSearchResponse {
  const items = ids.map(id => makeItem(id));
  return makeResponse(items, [makeGroup("dmcc", items, totalMatches)], total);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  valuesImpl.mockResolvedValue([{ id: "row-1" }]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mockEnrichResponse.mockResolvedValue(new Map());
});

async function renderSearch(params: { q?: string; page?: string }) {
  return renderElement(await SearchResults({ searchParams: Promise.resolve(params) }));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("/search pagination", () => {
  it("renders the activities of the requested page, not the top hits of the whole set", async () => {
    signInAsUser({ id: USER_ID });

    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => `p1-act-${i}`);
    const page2 = Array.from({ length: PAGE_SIZE }, (_, i) => `p2-act-${i}`);

    mockSearchUnified.mockResolvedValueOnce(dmccPage(page1, 20));
    const first = await renderSearch({ q: "restaurant", page: "1" });

    mockSearchUnified.mockResolvedValueOnce(dmccPage(page2, 20));
    const second = await renderSearch({ q: "restaurant", page: "2" });

    // The engine is asked for the right window...
    expect(mockSearchUnified.mock.calls[0]![0]).toMatchObject({ limit: PAGE_SIZE, offset: 0 });
    expect(mockSearchUnified.mock.calls[1]![0]).toMatchObject({ limit: PAGE_SIZE, offset: PAGE_SIZE });

    // ...and each page shows exactly its own window of results.
    for (const id of page1) expect(first.text).toContain(id);
    for (const id of page2) expect(second.text).toContain(id);
    for (const id of page1) expect(second.text).not.toContain(id);
  });

  it("a group cannot widen the page beyond the results the engine returned", async () => {
    signInAsUser({ id: USER_ID });

    // The contract this component relies on: `topResults` is the page, grouped.
    // Before the fix the engine filled `topResults` from every match, so a group
    // carried the global top hits regardless of the page — which is exactly how
    // page 2 ended up showing page 1. The component must not honour a group that
    // reaches outside the requested window.
    const onPage = makeItem("on-page-act");
    const offPage = makeItem("off-page-act");
    mockSearchUnified.mockResolvedValue(
      makeResponse([onPage], [makeGroup("dmcc", [onPage, offPage])], 2)
    );

    const rendered = await renderSearch({ q: "restaurant", page: "2" });

    expect(rendered.text).toContain("on-page-act");
    expect(rendered.text).not.toContain("off-page-act");
  });

  it("keeps the total match count and page count on every page", async () => {
    signInAsUser({ id: USER_ID });

    mockSearchUnified.mockResolvedValue(dmccPage(["a1", "a2"], 25, 25));
    const page1 = await renderSearch({ q: "restaurant", page: "1" });
    const page2 = await renderSearch({ q: "restaurant", page: "2" });
    const page3 = await renderSearch({ q: "restaurant", page: "3" });

    // The total is a property of the query, so it does not shrink per page...
    for (const rendered of [page1, page2, page3]) {
      expect(rendered.text).toContain("25 activities");
    }
    // ...but the position in the result set does.
    expect(page1.text).toContain("Page 1 of 3");
    expect(page2.text).toContain("Page 2 of 3");
    expect(page3.text).toContain("Page 3 of 3");
  });

  it("shows a partial final page without inventing extra results", async () => {
    signInAsUser({ id: USER_ID });

    const tail = ["tail-1", "tail-2"];
    mockSearchUnified.mockResolvedValue(dmccPage(tail, 12));

    const rendered = await renderSearch({ q: "restaurant", page: "2" });
    expect(rendered.text).toContain("tail-1");
    expect(rendered.text).toContain("tail-2");
    expect(rendered.text).toContain("Page 2 of 2");
  });

  it("handles a page past the end instead of repeating page 1", async () => {
    signInAsUser({ id: USER_ID });

    // total says 25 matches, but this request's page is empty — a stale or
    // hand-edited ?page=.
    mockSearchUnified.mockResolvedValue(dmccPage([], 25));

    const rendered = await renderSearch({ q: "restaurant", page: "9" });

    expect(rendered.text).toContain("Nothing on page 9");
    expect(rendered.text).toContain("Go to page 1");
    expect(rendered.text).not.toContain("No match found in currently indexed jurisdictions");
  });

  it("still reports the no-match state on page 1 when nothing matches at all", async () => {
    signInAsUser({ id: USER_ID });
    mockSearchUnified.mockResolvedValue(makeResponse([], [], 0));

    const rendered = await renderSearch({ q: "restaurant" });

    expect(rendered.text).toContain("No match found in currently indexed jurisdictions");
    expect(rendered.text).not.toContain("Nothing on page");
  });

  it("skips a matched jurisdiction whose matches all rank on other pages", async () => {
    signInAsUser({ id: USER_ID });

    // DMCC is on this page; ADGM matched overall but has nothing here.
    const dmcc = [makeItem("dmcc-act")];
    mockSearchUnified.mockResolvedValue(
      makeResponse(dmcc, [makeGroup("dmcc", dmcc), makeGroup("adgm", [], 4)], 5)
    );

    const rendered = await renderSearch({ q: "restaurant", page: "1" });

    expect(rendered.text).toContain("dmcc-act");
    // Availability is global, so ADGM is still reported as a match...
    expect(rendered.text).toContain("Found in 2 of 2 indexed jurisdictions");
    expect(rendered.text).toContain("4 matches");
    // ...but it gets no result section of its own on this page.
    expect(rendered.text).not.toContain("JurisdictionADGM");
  });
});

describe("/search enrichment follows the rendered cards", () => {
  it("enriches exactly the activities the page renders", async () => {
    signInAsUser({ id: USER_ID });

    const ids = Array.from({ length: 4 }, (_, i) => `act-${i}`);
    const items = ids.map(id => makeItem(id));
    mockSearchUnified.mockResolvedValue(
      makeResponse(items, [makeGroup("dmcc", items), makeGroup("adgm", [], 3)], 7)
    );
    mockEnrichResponse.mockResolvedValue(new Map(ids.map(id => [id, emptySummary()])));

    await renderSearch({ q: "restaurant", page: "1" });

    expect(mockEnrichResponse).toHaveBeenCalledTimes(1);
    const enriched = mockEnrichResponse.mock.calls[0]![0] as UnifiedSearchResponse;
    // Every rendered card is covered; the off-page jurisdiction contributes
    // nothing, and nothing outside the page is dragged in.
    expect(enriched.results.map(r => r.activity.id)).toEqual(ids);
  });

  it("each rendered card shows its OWN verified fee", async () => {
    signInAsUser({ id: USER_ID });

    const ids = ["rich-act", "plain-act"];
    const items = ids.map(id => makeItem(id));
    mockSearchUnified.mockResolvedValue(makeResponse(items, [makeGroup("dmcc", items)], 2));

    // Only ONE of the two activities has verified regulatory data.
    const rich: RegulatorySummary = {
      verifiedApprovals: [
        { name: "Trade licence", authorityName: "DMCC", lastVerified: "2026-01-02" },
      ],
      govFees: [{ amount: "33000", currency: "AED", feeType: "registration_fee", feeBasis: null, sourceId: null }],
      thirdPartyCosts: [],
    };
    mockEnrichResponse.mockResolvedValue(
      new Map([
        ["rich-act", rich],
        ["plain-act", emptySummary()],
      ])
    );

    const rendered = await renderSearch({ q: "restaurant" });

    // The enriched card reports its figure...
    expect(rendered.text).toContain("33,000");
    // ...and the unenriched one is honestly reported as unverified, never
    // borrowing the other card's number.
    expect(rendered.text.match(/33,000/g)).toHaveLength(1);
    expect(rendered.text).toContain("Not verified/published in indexed official sources");
    expect(rendered.text).toContain("Verified approval");
  });

  it("a card with no enrichment entry is never told it is 'not verified'", async () => {
    signInAsUser({ id: USER_ID });

    // An enrichment map that is missing the rendered activity entirely: the
    // wiring fault this test exists to catch.
    mockSearchUnified.mockResolvedValue(dmccPage(["lonely-act"], 1));
    mockEnrichResponse.mockResolvedValue(new Map());

    const rendered = await renderSearch({ q: "restaurant" });

    expect(rendered.text).toContain("Not checked");
    expect(rendered.text).not.toContain("Not verified/published in indexed official sources");
    expect(rendered.text).not.toMatch(/Not verified\b(?![\s\S]*Not verified\/)/);
  });

  it("records usage once per rendered page, after authorisation", async () => {
    signInAsUser({ id: USER_ID });
    mockSearchUnified.mockResolvedValue(dmccPage(["a1"], 1));

    await renderSearch({ q: "restaurant", page: "1" });

    expect(valuesImpl).toHaveBeenCalledTimes(1);
  });
});