import { describe, it, expect, vi, beforeEach } from "vitest";
import { authViewerMock, resetAuth, signInAsUser } from "../helpers/auth-mock";

// A signed-in viewer keeps the auth-gated client controls out of the tree.
vi.mock("@/lib/auth/viewer", () => authViewerMock());

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn() })),
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

vi.mock("@/lib/search/enrichment", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/search/enrichment")>();
  return {
    collectRenderedActivityIds: actual.collectRenderedActivityIds,
    // Both resolve to Map<activityId, RegulatorySummary>; no regulatory data is
    // under test here.
    getRegulatorySummaries: vi.fn(() => new Map()),
    enrichResponse: vi.fn(() => new Map()),
  };
});

// `next/link` needs a Next router context to resolve an href; outside one it
// renders an anchor with no href. Stubbed to keep the href observable, since
// the link target is exactly what these tests assert.
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, children }: Record<string, unknown>) =>
      createElement("a", { href }, children as never),
  };
});

// Client components: this harness calls function components outside a React
// runtime, so hooks cannot run. See tests/unit/share-button-interaction.test.ts.
vi.mock("@/components/compare/search-compare-bar", () => ({
  SearchCompareBar: () => null,
}));
vi.mock("@/components/activities/share-button", () => ({
  ShareButton: () => null,
}));
vi.mock("@/components/activities/copy-identifier-button", () => ({
  CopyIdentifierButton: () => null,
}));

import { SearchResults } from "@/components/search/search-results-list";
import { renderElement } from "../helpers/render";

/**
 * A jurisdiction group holding more matches than the page displays must offer a
 * way to reach the rest.
 *
 * The figure the link advertises has to be the engine's page-independent
 * `totalMatches`, never a re-count of the rows on screen, so the badge and the
 * link cannot disagree. `next/link` is deliberately NOT mocked here, because the
 * href is the thing under test.
 */

function makeResult(id: string, name: string, slug: string) {
  return {
    activity: {
      id,
      officialName: name,
      normalizedName: name.toLowerCase(),
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
      id: `jur-${slug}`,
      name: slug.toUpperCase(),
      slug,
      emirate: "dubai",
      jurisdictionType: "free_zone",
    },
    matchType: "exact",
    matchScore: 1,
    licenceType: null,
    source: null,
    matchReasons: [],
  };
}

interface TestGroup {
  jurisdiction: { id: string; name: string; slug: string; emirate: string; jurisdictionType: string };
  totalMatches: number;
  bestMatchType: string;
  topResults: ReturnType<typeof makeResult>[];
  status: string;
}

function makeGroup(
  slug: string,
  topResults: ReturnType<typeof makeResult>[],
  totalMatches: number
): TestGroup {
  return {
    jurisdiction: {
      id: `jur-${slug}`,
      name: slug.toUpperCase(),
      slug,
      emirate: "dubai",
      jurisdictionType: "free_zone",
    },
    totalMatches,
    bestMatchType: "exact",
    topResults,
    status: "match",
  };
}

async function renderWithGroups(
  groups: TestGroup[],
  total: number,
  query = "general trading"
) {
  mockSearchUnified.mockResolvedValue({
    query,
    total,
    results: groups.flatMap(g => g.topResults),
    jurisdictionGroups: groups,
    availability: {
      matchedJurisdictionSlugs: groups.filter(g => g.status === "match").map(g => g.jurisdiction.slug),
      unmatched: [],
    },
    intent: {
      primaryNoun: "general",
      industryDomain: "general",
      specificityLevel: "broad",
      isGenericQuery: false,
      searchIntents: ["ACTIVITY_SEARCH"],
      jurisdictionSlug: null,
      jurisdictionName: null,
      businessTerms: ["general"],
      typoCorrected: false,
    },
    meta: { tookMs: 1, candidatesEvaluated: total, minRelevanceThreshold: 0.62 },
  });

  return renderElement(
    await SearchResults({
      searchParams: Promise.resolve({ q: query, page: "1" }),
    })
  );
}

function hrefs(el: { nodes: Array<{ type: string; props: Record<string, unknown> }> }) {
  return el.nodes
    .filter(n => n.type === "a")
    .map(n => n.props["href"])
    .filter((h): h is string => typeof h === "string");
}

beforeEach(() => {
  mockSearchUnified.mockReset();
  resetAuth();
  signInAsUser({ id: "user-1" });
});

describe("a jurisdiction group with more matches than the page shows", () => {
  it("offers a see-all link scoped to that jurisdiction", async () => {
    const el = await renderWithGroups(
      [makeGroup("dmcc", [makeResult("a1", "General Trading", "dmcc")], 12)],
      12
    );
    const seeAll = hrefs(el).find(h => h.includes("jurisdiction=dmcc"));
    expect(seeAll).toBeDefined();
  });

  it("keeps the original query in the see-all link", async () => {
    const el = await renderWithGroups(
      [makeGroup("dmcc", [makeResult("a1", "General Trading", "dmcc")], 12)],
      12,
      "general trading"
    );
    const seeAll = hrefs(el).find(h => h.includes("jurisdiction=dmcc"));
    expect(seeAll).toContain("q=general");
    expect(seeAll).toContain("q=general+trading");
  });

  it("starts the filtered view at page 1", async () => {
    const el = await renderWithGroups(
      [makeGroup("dmcc", [makeResult("a1", "General Trading", "dmcc")], 12)],
      12
    );
    const seeAll = hrefs(el).find(h => h.includes("jurisdiction=dmcc"));
    expect(seeAll).toContain("page=1");
  });

  it("never puts a private or internal identifier in the link", async () => {
    const el = await renderWithGroups(
      [makeGroup("dmcc", [makeResult("a1", "General Trading", "dmcc")], 12)],
      12
    );
    const seeAll = hrefs(el).find(h => h.includes("jurisdiction=dmcc")) as string;
    expect(seeAll).not.toContain("a1");
    expect(seeAll).not.toMatch(/token|session|user|email/i);
  });
});

describe("a jurisdiction group fully shown on the page", () => {
  it("does not offer a see-all link", async () => {
    const el = await renderWithGroups(
      [makeGroup("dmcc", [makeResult("a1", "General Trading", "dmcc")], 1)],
      1
    );
    expect(hrefs(el).some(h => h.includes("jurisdiction=dmcc"))).toBe(false);
  });

  it("adds the link only for the group that is truncated", async () => {
    const el = await renderWithGroups(
      [
        makeGroup("dmcc", [makeResult("a1", "General Trading", "dmcc")], 12),
        makeGroup("rakez", [makeResult("a2", "General Trading", "rakez")], 1),
      ],
      13
    );
    const all = hrefs(el);
    expect(all.some(h => h.includes("jurisdiction=dmcc"))).toBe(true);
    expect(all.some(h => h.includes("jurisdiction=rakez"))).toBe(false);
  });
});



