import { describe, it, expect, vi, beforeEach } from "vitest";
import { authViewerMock, resetAuth, signInAsUser, signInAsSuspended } from "../helpers/auth-mock";

/**
 * Usage recording on the `/search` page.
 *
 * The API route and this component are two separate paths into the same engine,
 * so both have to enforce the same attribution rules. These tests pin the
 * component's behaviour specifically: the session is resolved before the
 * recorder is reached, so a visitor who never had a session can never produce a
 * row, and a suspended account can neither search nor leave a trace.
 */
vi.mock("@/lib/auth/viewer", () => authViewerMock());

const { mockInsert, valuesImpl } = vi.hoisted(() => {
  const valuesImpl = vi.fn();
  return {
    valuesImpl,
    mockInsert: vi.fn<(table: unknown) => { values: typeof valuesImpl }>(
      () => ({ values: valuesImpl })
    ),
  };
});

vi.mock("@/lib/db", () => ({
  db: { insert: mockInsert, select: vi.fn(() => ({})) },
}));

const mockSearchUnified = vi.fn();
vi.mock("@/lib/search/engine", () => ({
  searchUnified: (...args: unknown[]) => mockSearchUnified(...args),
}));

vi.mock("@/lib/search/enrichment", () => ({ enrichResponse: (r: unknown) => r }));

vi.mock("next/link", () => ({
  default: ({ children }: { children?: unknown }) => children,
}));

import { SearchResults } from "@/components/search/search-results-list";
import { renderElement } from "../helpers/render";

const LAYLA_ID = "11111111-1111-4111-8111-111111111111";

function writtenRows(): Array<Record<string, unknown>> {
  return valuesImpl.mock.calls.map(args => args[0] as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  valuesImpl.mockResolvedValue([{ id: "row-1" }]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mockSearchUnified.mockResolvedValue({
    query: "cafe",
    total: 0,
    results: [],
    facets: {},
    suggestions: [],
    jurisdictionGroups: [],
    availability: { indexedJurisdictionSlugs: [], matchedJurisdictionSlugs: [] },
    meta: { tookMs: 1, candidatesEvaluated: 0, minRelevanceThreshold: 0.62 },
  });
});

describe("/search records usage for an active user", () => {
  it("writes exactly one row for the signed-in viewer", async () => {
    signInAsUser({ id: LAYLA_ID });
    await renderElement(await SearchResults({ searchParams: Promise.resolve({ q: "cafe" }) }));

    expect(writtenRows()).toEqual([{ userId: LAYLA_ID, query: "cafe" }]);
  });

  it("still renders the results", async () => {
    signInAsUser({ id: LAYLA_ID });
    const { text } = await renderElement(await SearchResults({ searchParams: Promise.resolve({ q: "cafe" }) }));
    expect(text.length).toBeGreaterThan(0);
  });

  it("records nothing for a query-less visit", async () => {
    signInAsUser({ id: LAYLA_ID });
    await renderElement(await SearchResults({ searchParams: Promise.resolve({}) }));
    expect(writtenRows()).toHaveLength(0);
  });

  it("records a whitespace-only query as nothing", async () => {
    signInAsUser({ id: LAYLA_ID });
    await renderElement(await SearchResults({ searchParams: Promise.resolve({ q: "   " }) }));
    expect(writtenRows()).toHaveLength(0);
  });

  it("records nothing when the engine throws", async () => {
    signInAsUser({ id: LAYLA_ID });
    mockSearchUnified.mockRejectedValue(new Error("engine down"));

    const { text } = await renderElement(await SearchResults({ searchParams: Promise.resolve({ q: "cafe" }) }));

    // The page shows its own error message instead, and claims no search ran.
    expect(text).toMatch(/something went wrong/i);
    expect(writtenRows()).toHaveLength(0);
  });

  it("renders the results even when the usage write fails", async () => {
    signInAsUser({ id: LAYLA_ID });
    mockSearchUnified.mockResolvedValue({
      query: "cafe",
      total: 0,
      results: [],
      facets: {},
      suggestions: [],
      jurisdictionGroups: [],
      availability: { indexedJurisdictionSlugs: [], matchedJurisdictionSlugs: [] },
      meta: { tookMs: 1, candidatesEvaluated: 0, minRelevanceThreshold: 0.62 },
    });
    valuesImpl.mockRejectedValue(new Error("connection terminated"));

    const { text } = await renderElement(await SearchResults({ searchParams: Promise.resolve({ q: "cafe" }) }));

    expect(text).not.toMatch(/something went wrong/i);
    expect(text.length).toBeGreaterThan(0);
  });

  it("does not put the failure on the page", async () => {
    signInAsUser({ id: LAYLA_ID });
    valuesImpl.mockRejectedValue(new Error("password authentication failed"));

    const { text } = await renderElement(
      await SearchResults({ searchParams: Promise.resolve({ q: "cafe" }) })
    );

    // The database message never reaches the page. The user's own query does
    // appear, but only because this test page echoes it back in its
    // no-results state — it is the user's own input, not a stored value.
    expect(text).not.toMatch(/password authentication/i);
    expect(text).not.toMatch(/connection terminated/i);
  });

  it("counts each paginated request separately", async () => {
    signInAsUser({ id: LAYLA_ID });
    await renderElement(await SearchResults({ searchParams: Promise.resolve({ q: "cafe", page: "1" }) }));
    await renderElement(await SearchResults({ searchParams: Promise.resolve({ q: "cafe", page: "2" }) }));

    expect(writtenRows()).toHaveLength(2);
    expect(writtenRows().every(row => row.query === "cafe")).toBe(true);
  });
});

describe("/search records nothing without a usable session", () => {
  /**
   * The anonymous branch returns `SearchSignInWall`, a client component that
   * calls `useState` — outside what the hand-rolled walker in
   * `tests/helpers/render.ts` can execute. These tests therefore await the
   * component without walking its tree and assert on the side effects, which is
   * what actually matters here: the engine is not reached and nothing is
   * written.
   */
  it("records nothing for an anonymous visitor", async () => {
    resetAuth();
    await SearchResults({ searchParams: Promise.resolve({ q: "cafe" }) });
    expect(writtenRows()).toHaveLength(0);
  });

  it("does not run the engine for an anonymous visitor", async () => {
    resetAuth();
    await SearchResults({ searchParams: Promise.resolve({ q: "cafe" }) });
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it("records nothing for a suspended user", async () => {
    signInAsSuspended({ id: LAYLA_ID });
    await renderElement(await SearchResults({ searchParams: Promise.resolve({ q: "cafe" }) }));
    expect(writtenRows()).toHaveLength(0);
  });

  it("does not run the engine for a suspended user", async () => {
    signInAsSuspended({ id: LAYLA_ID });
    await renderElement(await SearchResults({ searchParams: Promise.resolve({ q: "cafe" }) }));
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it("shows a suspension notice rather than a sign-in prompt", async () => {
    signInAsSuspended({ id: LAYLA_ID });
    const { text } = await renderElement(await SearchResults({ searchParams: Promise.resolve({ q: "cafe" }) }));
    // Re-authenticating does not lift a suspension, so prompting to sign in
    // would be a dead end.
    expect(text).toMatch(/suspended/i);
  });
});
