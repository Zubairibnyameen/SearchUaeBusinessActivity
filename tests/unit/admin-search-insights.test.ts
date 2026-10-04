import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: { select: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("server-only", () => ({}));

import {
  getSearchInsights,
  getSearchInsightsSafely,
  TOP_QUERY_LIMIT,
  RECENT_SEARCH_LIMIT,
  TREND_DAYS,
  type SearchInsights,
} from "@/lib/admin/search-insights";

/**
 * Admin search intelligence is aggregate-only by construction.
 *
 * `search_usage` is a per-user table, so the privacy boundary is not a policy
 * statement - it is enforced by the fact that no returned object contains a
 * user identifier. These tests assert that boundary, and that the panel reports
 * "cannot measure" instead of inventing result-quality figures.
 */

type SelectChain = Record<string, unknown>;

/** Builds a chainable drizzle-like builder that resolves to `rows`. */
function chain(rows: unknown) {
  const self: SelectChain = {};
  for (const method of ["from", "where", "groupBy", "orderBy", "limit"]) {
    self[method] = vi.fn(() => self);
  }
  self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return self;
}

function overviewRow(overrides: Record<string, number> = {}) {
  return {
    totalSearches: 120,
    distinctQueries: 40,
    searchers: 25,
    last7Days: 30,
    last30Days: 90,
    ...overrides,
  };
}

function setupRows({
  overview = overviewRow(),
  top = [],
  recent = [],
  daily = [],
}: {
  overview?: unknown;
  top?: unknown[];
  recent?: unknown[];
  daily?: unknown[];
} = {}) {
  dbMock.select
    .mockReset()
    .mockImplementationOnce(() => chain([overview]))
    .mockImplementationOnce(() => chain(top))
    .mockImplementationOnce(() => chain(recent))
    .mockImplementationOnce(() => chain(daily));
}

async function insightsFrom(result: { insights: SearchInsights | null; error: string | null }) {
  expect(result.error).toBeNull();
  return result.insights as SearchInsights;
}

describe("getSearchInsights aggregates", () => {
  beforeEach(() => dbMock.select.mockReset());

  it("returns the overview counts unchanged", async () => {
    setupRows();
    const insights = await insightsFrom(await getSearchInsights());
    expect(insights.totalSearches).toBe(120);
    expect(insights.distinctQueries).toBe(40);
    expect(insights.searchers).toBe(25);
    expect(insights.last7Days).toBe(30);
    expect(insights.last30Days).toBe(90);
  });

  it("returns top queries and recent searches with their counts", async () => {
    const when = new Date("2026-01-02T03:04:05Z");
    setupRows({
      top: [{ query: "general trading", searches: 12, searchers: 7, lastSearchedAt: when }],
      recent: [{ query: "restaurant", searchedAt: when }],
      daily: [{ day: "2026-01-02", searches: 4 }],
    });
    const insights = await insightsFrom(await getSearchInsights());
    expect(insights.topQueries).toHaveLength(1);
    expect(insights.topQueries[0].query).toBe("general trading");
    expect(insights.topQueries[0].searches).toBe(12);
    expect(insights.recentSearches).toHaveLength(1);
    expect(insights.dailyVolume).toHaveLength(1);
  });

  it("exposes no account identifier on any returned row", async () => {
    const when = new Date("2026-01-02T03:04:05Z");
    setupRows({
      top: [{ query: "general trading", searches: 12, searchers: 7, lastSearchedAt: when }],
      recent: [{ query: "restaurant", searchedAt: when }],
    });
    const insights = await insightsFrom(await getSearchInsights());

    // Serialising the whole payload must not surface any identity field.
    const serialised = JSON.stringify(insights);
    for (const forbidden of ["userId", "user_id", "email", "name", "auth", "token"]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    for (const row of [...insights.topQueries, ...insights.recentSearches]) {
      expect(Object.keys(row)).not.toContain("userId");
    }
  });

  it("reports result-quality metrics as unavailable rather than zero", async () => {
    setupRows();
    const insights = await insightsFrom(await getSearchInsights());
    // `search_usage` stores no result count, so these figures must be absent
    // rather than reported as "0 low-result searches".
    expect(insights.resultCountAvailable).toBe(false);
    expect(insights.trendDays).toBe(TREND_DAYS);
  });

  it("caps top queries, recent searches and the trend window", () => {
    expect(TOP_QUERY_LIMIT).toBeGreaterThan(0);
    expect(TOP_QUERY_LIMIT).toBeLessThanOrEqual(100);
    expect(RECENT_SEARCH_LIMIT).toBeGreaterThan(0);
    expect(RECENT_SEARCH_LIMIT).toBeLessThanOrEqual(100);
    expect(TREND_DAYS).toBeGreaterThan(0);
    expect(TREND_DAYS).toBeLessThanOrEqual(90);
  });
});

describe("getSearchInsights failure handling", () => {
  beforeEach(() => {
    dbMock.select.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns a null insight and a message instead of zeroes when the read fails", async () => {
    dbMock.select.mockImplementation(() => {
      throw new Error("relation \"search_usage\" does not exist");
    });
    const result = await getSearchInsightsSafely();
    expect(result.insights).toBeNull();
    expect(result.error).toMatch(/search insights/i);
    expect(result.error).not.toMatch(/does not exist/);
  });

  it("does not leak the underlying database error to the panel", async () => {
    dbMock.select.mockImplementation(() => {
      throw new Error("password authentication failed for user admin");
    });
    const result = await getSearchInsightsSafely();
    expect(result.error).not.toMatch(/password/i);
    expect(result.insights).toBeNull();
  });
});
