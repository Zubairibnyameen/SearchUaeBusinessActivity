import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));
vi.mock("server-only", () => ({}));

// `next/link` resolves its href from the Next router context, which is absent
// here; stubbed so the link target stays observable.
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, children }: Record<string, unknown>) =>
      createElement("a", { href }, children as never),
  };
});

const mockGetInsightsSafely = vi.fn();

vi.mock("@/lib/admin/search-insights", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/admin/search-insights")>();
  return {
    ...actual,
    getSearchInsightsSafely: (...args: unknown[]) => mockGetInsightsSafely(...args),
  };
});

import { SearchInsightsPanel } from "@/components/admin/search-insights-panel";
import { renderElement } from "../helpers/render";
import type { SearchInsights } from "@/lib/admin/search-insights";

/**
 * The panel has to be honest about what it does not know.
 *
 * `search_usage` records no result count, so "zero-result searches" and "weak
 * relevance" cannot be computed. Showing a confident zero there would be worse
 * than omitting the section, because a reader would act on it. These tests pin
 * the three states the panel can be in: unavailable, empty, and populated.
 */

const when = new Date("2026-01-02T03:04:05Z");

function insights(overrides: Partial<SearchInsights> = {}): SearchInsights {
  return {
    totalSearches: 120,
    distinctQueries: 40,
    searchers: 25,
    last7Days: 30,
    last30Days: 90,
    topQueries: [
      { query: "general trading", searches: 12, searchers: 7, lastSearchedAt: when },
    ],
    recentSearches: [{ query: "restaurant", searchedAt: when }],
    dailyVolume: [
      { day: "2026-01-01", searches: 3 },
      { day: "2026-01-02", searches: 9 },
    ],
    resultCountAvailable: false,
    trendDays: 14,
    ...overrides,
  };
}

beforeEach(() => {
  mockGetInsightsSafely.mockReset();
});

describe("admin search insights panel", () => {
  it("states plainly that the panel could not be read", async () => {
    mockGetInsightsSafely.mockResolvedValue({
      insights: null,
      error: "Search insights are unavailable.",
    });
    const el = await renderElement(await SearchInsightsPanel());
    expect(el.text).toMatch(/unavailable/i);
    // A failed read must not be dressed up as "no searches happened".
    expect(el.text).not.toMatch(/no searches have been recorded/i);
  });

  it("distinguishes an empty table from a failed read", async () => {
    mockGetInsightsSafely.mockResolvedValue({
      insights: insights({
        totalSearches: 0,
        distinctQueries: 0,
        searchers: 0,
        last7Days: 0,
        last30Days: 0,
        topQueries: [],
        recentSearches: [],
        dailyVolume: [],
      }),
      error: null,
    });
    const el = await renderElement(await SearchInsightsPanel());
    expect(el.text).toMatch(/no searches have been recorded/i);
  });

  it("renders the headline counts when data exists", async () => {
    mockGetInsightsSafely.mockResolvedValue({ insights: insights(), error: null });
    const el = await renderElement(await SearchInsightsPanel());
    expect(el.text).toMatch(/120/);
    expect(el.text).toMatch(/distinct queries/i);
    expect(el.text).toMatch(/accounts that searched/i);
  });

  it("shows the top queries and recent searches", async () => {
    mockGetInsightsSafely.mockResolvedValue({ insights: insights(), error: null });
    const el = await renderElement(await SearchInsightsPanel());
    expect(el.text).toContain("general trading");
    expect(el.text).toContain("restaurant");
    expect(el.text).toMatch(/most searched/i);
    expect(el.text).toMatch(/recent searches/i);
  });

  it("discloses that result-quality metrics are not measurable", async () => {
    mockGetInsightsSafely.mockResolvedValue({ insights: insights(), error: null });
    const el = await renderElement(await SearchInsightsPanel());
    expect(el.text).toMatch(/not measurable/i);
    expect(el.text).toMatch(/zero-result/i);
    // The reason must be given, so the gap reads as a known limitation rather
    // than an oversight.
    expect(el.text).toMatch(/search_usage/);
  });

  it("never renders an account identifier", async () => {
    mockGetInsightsSafely.mockResolvedValue({ insights: insights(), error: null });
    const el = await renderElement(await SearchInsightsPanel());
    expect(el.text).not.toMatch(/@/);
    expect(el.text).not.toMatch(/user id|user_id/i);
  });

  it("links a top query straight into the public search", async () => {
    mockGetInsightsSafely.mockResolvedValue({ insights: insights(), error: null });
    const el = await renderElement(await SearchInsightsPanel());
    const searchHrefs = el.nodes
      .filter(n => n.type === "a")
      .map(n => n.props["href"])
      .filter((h): h is string => typeof h === "string" && h.startsWith("/search"));
    expect(searchHrefs.length).toBeGreaterThan(0);
    expect(searchHrefs[0]).toContain("q=general");
  });
});

