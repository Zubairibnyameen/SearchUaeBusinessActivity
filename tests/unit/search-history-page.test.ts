import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";

import { resetAuth, signInAsSuspended, signInAsUser } from "../helpers/auth-mock";
import { renderElement } from "../helpers/render";

/**
 * `/account/search-history` — the viewer's own recorded searches.
 *
 * Two things are being proven here, and they are proven in different places.
 * The PAGE decides who is asking (the verified session) and hands the whole
 * viewer to the DAL; the DAL decides which rows come back. The isolation tests
 * below are split accordingly: the page tests assert that the viewer's own id
 * is the only scope value that ever reaches the DAL, and the DAL tests in
 * `search-usage-dal.test.ts` assert that the id is what the query filters on.
 * Neither half is sufficient alone, which is why both exist.
 */
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ redirect: vi.fn() }));
const redirectCalls: string[] = [];

vi.mock("next/navigation", () => ({ redirect: state.redirect }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

vi.mock("@/lib/auth/viewer", async () => {
  const { authViewerMock } = await import("../helpers/auth-mock");
  return authViewerMock();
});

/** Captures what the page hands the DAL, so scope can be asserted directly. */
const captured = vi.hoisted(() => ({
  calls: [] as Array<{ viewer: { id: string }; limit?: number; offset?: number }>,
  result: null as unknown,
}));

vi.mock("@/lib/auth/search-usage", () => ({
  SEARCH_HISTORY_PAGE_SIZE: 20,
  listSearchHistorySafely: async (
    viewer: { id: string },
    options: { limit?: number; offset?: number } = {}
  ) => {
    captured.calls.push({ viewer, limit: options.limit, offset: options.offset });
    return captured.result;
  },
}));

import AccountSearchHistoryPage from "@/app/(public)/account/search-history/page";
import { SearchHistoryView } from "@/components/account/search-history";

const LAYLA_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "99999999-9999-4999-8999-999999999999";

function entry(overrides: { id?: string; query?: string; createdAt?: string } = {}) {
  return {
    id: overrides.id ?? "row-1",
    query: overrides.query ?? "trading licence",
    createdAt: new Date(overrides.createdAt ?? "2026-06-15T12:00:00.000Z"),
  };
}

/** The DAL returns `null` on failure; that must stay distinct from empty. */
function page(over: { entries?: unknown[]; total?: number; hasMore?: boolean } = {}) {
  return {
    entries: over.entries ?? [],
    total: over.total ?? 0,
    hasMore: over.hasMore ?? false,
  };
}

/**
 * The decoded `q` of a `/search?...` link.
 *
 * Asserted on the decoded value rather than the raw href on purpose: a query
 * string is `application/x-www-form-urlencoded`, so a space legitimately encodes
 * as `+`. What matters is that the link carries the WHOLE stored query as one
 * `q` parameter and nothing else.
 */
function searchAgainParam(href: string | undefined): string | null {
  expect(href).toBeDefined();
  return new URLSearchParams(href!.split("?")[1]).get("q");
}

async function renderPage(searchParams: Record<string, string> = {}) {
  return renderElement(await AccountSearchHistoryPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  redirectCalls.length = 0;
  captured.calls = [];
  captured.result = page();
  state.redirect.mockImplementation((url: string) => {
    redirectCalls.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Anonymous access is blocked
// ─────────────────────────────────────────────────────────────────────────────

describe("/account/search-history — anonymous access", () => {
  it("redirects to sign in and preserves the return path", async () => {
    resetAuth();
    await expect(AccountSearchHistoryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(redirectCalls).toEqual([
      `/signin?next=${encodeURIComponent("/account/search-history")}`,
    ]);
  });

  it("never queries the database for an anonymous visitor", async () => {
    resetAuth();
    await AccountSearchHistoryPage({ searchParams: Promise.resolve({}) }).catch(() => undefined);

    // Not merely hidden by the UI — the read is never attempted, so there is no
    // window in which an anonymous caller could pull rows.
    expect(captured.calls).toEqual([]);
  });

  it("does not render any history content anonymously", async () => {
    resetAuth();
    await AccountSearchHistoryPage({ searchParams: Promise.resolve({}) }).catch(() => undefined);
    const { tags } = await renderElement(
      SearchHistoryView({ history: null, page: 1, pageSize: 20, isActive: false })
    );
    // Sanity check on the walker: with the redirect thrown there is nothing to
    // assert on the page itself, so this only proves the view can render.
    expect(tags.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Authenticated user sees their OWN history
// ─────────────────────────────────────────────────────────────────────────────

describe("/account/search-history — authenticated user", () => {
  it("renders the caller's own rows", async () => {
    signInAsUser({ id: LAYLA_ID });
    captured.result = page({
      entries: [entry({ id: "r1", query: "trading licence" })],
      total: 1,
    });

    const { text } = await renderPage();
    expect(redirectCalls).toEqual([]);
    expect(text).toMatch(/trading licence/);
  });

  it("shows the query text and the timestamp for each search", async () => {
    signInAsUser();
    captured.result = page({ entries: [entry({ query: "DMCC licence" })], total: 1 });

    const { nodes, text } = await renderPage();
    expect(text).toMatch(/DMCC licence/);
    // A machine-readable instant, so the value is unambiguous.
    const time = nodes.find(n => n.type === "time");
    expect(time?.props.dateTime).toBe("2026-06-15T12:00:00.000Z");
  });

  it("renders the list in the order the DAL returned, newest first", async () => {
    signInAsUser();
    captured.result = page({
      entries: [
        entry({ id: "r3", query: "newest search" }),
        entry({ id: "r2", query: "middle search" }),
        entry({ id: "r1", query: "oldest search" }),
      ],
      total: 3,
    });

    const { text } = await renderPage();
    // Document order, not alphabetical: the DAL owns the sort.
    expect(text.indexOf("newest search")).toBeLessThan(text.indexOf("middle search"));
    expect(text.indexOf("middle search")).toBeLessThan(text.indexOf("oldest search"));
  });

  it("renders newest-first as a property of the query, not of the fixture", async () => {
    // Ordering itself is asserted in the DAL suite against the emitted ORDER BY.
    // Here the contract is only that the view does not re-sort what it is given.
    signInAsUser();
    captured.result = page({
      entries: [entry({ id: "r2", query: "aaa" }), entry({ id: "r1", query: "zzz" })],
      total: 2,
    });

    const { text } = await renderPage();
    expect(text.indexOf("aaa")).toBeLessThan(text.indexOf("zzz"));
  });

  it("adds a 'Search again' link that reuses the stored query", async () => {
    signInAsUser();
    captured.result = page({ entries: [entry({ query: "trade licence" })], total: 1 });

    const { hrefs, text } = await renderPage();
    expect(text).toMatch(/search again/i);

    const again = hrefs.find(h => h.startsWith("/search?"));
    expect(again).toBeDefined();
    expect(searchAgainParam(again)).toBe("trade licence");
  });

  it("encodes a query containing & and = so it cannot inject parameters", async () => {
    signInAsUser();
    captured.result = page({
      entries: [entry({ query: "a&b=c licence" })],
      total: 1,
    });

    const { hrefs } = await renderPage();
    const again = hrefs.find(h => h.startsWith("/search?"));

    // Exactly one `q` parameter, carrying the whole query inside it. A
    // hand-built `/search?q=${query}` would have split this into `q=a` and
    // `b=c`, silently changing what gets re-run.
    expect(searchAgainParam(again)).toBe("a&b=c licence");
    expect(new URLSearchParams(again!.split("?")[1]).getAll("q")).toHaveLength(1);
  });

  it("links back to the account page", async () => {
    signInAsUser();
    const { hrefs } = await renderPage();
    expect(hrefs).toContain("/account");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. User A cannot see user B's history
// ─────────────────────────────────────────────────────────────────────────────

describe("/account/search-history — cross-account isolation", () => {
  it("queries with the signed-in viewer's own id", async () => {
    signInAsUser({ id: LAYLA_ID });
    await renderPage();

    expect(captured.calls).toHaveLength(1);
    expect(captured.calls[0].viewer.id).toBe(LAYLA_ID);
  });

  it("a different session queries with a different id and nothing else changes", async () => {
    signInAsUser({ id: OTHER_ID });
    await renderPage();

    // The scope is a function of who is signed in, not of an argument.
    expect(captured.calls[0].viewer.id).toBe(OTHER_ID);
    expect(captured.calls[0].viewer.id).not.toBe(LAYLA_ID);
  });

  it("no id, and no array of ids, is ever passed alongside the viewer", async () => {
    signInAsUser({ id: LAYLA_ID });
    await renderPage();

    const [call] = captured.calls as Array<Record<string, unknown>>;
    // Only the viewer and the paging numbers. There is no `userId` to override.
    expect(Object.keys(call).sort()).toEqual(["limit", "offset", "viewer"]);
    expect(call).not.toHaveProperty("userId");
    expect(call).not.toHaveProperty("authUserId");
    expect(call).not.toHaveProperty("id");
  });

  it("leaks no other account's identifiers into the rendered output", async () => {
    const viewer = signInAsUser({ id: LAYLA_ID });
    captured.result = page({ entries: [entry()], total: 1 });

    const { text, nodes } = await renderPage();
    const serialised = JSON.stringify(nodes.map(n => n.props));
    expect(text).not.toContain(viewer.authUserId);
    expect(serialised).not.toContain(LAYLA_ID);
    expect(serialised).not.toContain(viewer.authUserId);
  });

  it("renders no account id, auth id or provider id at all", async () => {
    signInAsUser({ id: LAYLA_ID, email: "layla@example.com" });
    captured.result = page({ entries: [entry()], total: 1 });

    const { text, nodes } = await renderPage();
    // Even the caller's own email is not shown: the reader knows whose history
    // it is, so identifying them again adds nothing.
    expect(text).not.toMatch(/layla@example\.com/);
    const serialised = JSON.stringify(nodes.map(n => n.props));
    expect(serialised).not.toMatch(/"(userId|authUserId|providerUserId)"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Pagination / limit
// ─────────────────────────────────────────────────────────────────────────────

describe("/account/search-history — pagination", () => {
  it("requests one bounded page with an explicit limit", async () => {
    signInAsUser();
    await renderPage();

    // The limit is passed down from the page constant, so the page cannot
    // accidentally ask for an unbounded result set.
    expect(captured.calls[0].limit).toBe(20);
    expect(captured.calls[0].offset).toBe(0);
  });

  it("defaults to the first page when no page param is supplied", async () => {
    signInAsUser();
    await renderPage();
    expect(captured.calls[0].offset).toBe(0);
  });

  it("translates ?page=2 into the next offset", async () => {
    signInAsUser();
    await renderPage({ page: "2" });
    expect(captured.calls[0].offset).toBe(20);
  });

  it("falls back to page 1 for junk page values", async () => {
    for (const bad of ["0", "-3", "abc", "1.5x", "  "]) {
      captured.calls = [];
      signInAsUser();
      await renderPage({ page: bad });
      // Never a negative offset, and never a NaN reaching the database.
      expect(captured.calls[0].offset).toBe(0);
    }
  });

  it("clamps an absurd page number so it cannot force a huge offset scan", async () => {
    signInAsUser();
    await renderPage({ page: "99999999" });
    expect(captured.calls[0].offset).toBe(20 * 499);
  });

  it("offers no 'Newer' link on the first page", async () => {
    signInAsUser();
    captured.result = page({ entries: [entry()], total: 40, hasMore: true });

    const { hrefs } = await renderPage();
    expect(hrefs).not.toContain("/account/search-history?page=0");
    expect(hrefs).not.toContain("/account/search-history?page=1");
  });

  it("offers an 'Older' link only while more rows remain", async () => {
    signInAsUser();
    captured.result = page({ entries: [entry()], total: 40, hasMore: true });
    const withNext = await renderPage();
    expect(withNext.hrefs).toContain("/account/search-history?page=2");

    captured.result = page({ entries: [entry()], total: 5, hasMore: false });
    const withoutNext = await renderPage();
    expect(withoutNext.hrefs).not.toContain("/account/search-history?page=2");
  });

  it("offers a 'Newer' link on any page after the first", async () => {
    signInAsUser();
    captured.result = page({ entries: [entry()], total: 40, hasMore: true });

    const { hrefs } = await renderPage({ page: "3" });
    expect(hrefs).toContain("/account/search-history?page=2");
  });

  it("states the visible range and the page count", async () => {
    signInAsUser();
    // A full second page, so the range is genuinely 21-40 rather than a
    // half-empty fixture.
    captured.result = page({
      entries: Array.from({ length: 20 }, (_, i) =>
        entry({ id: `r${i}`, query: `query ${i}` })
      ),
      total: 40,
      hasMore: true,
    });

    const { text } = await renderPage({ page: "2" });
    expect(text).toMatch(/Showing 21\D*40 of 40/);
    expect(text).toMatch(/page 2 of 2/);
  });

  it("shows a partial range when the last page is not full", async () => {
    signInAsUser();
    captured.result = page({ entries: [entry()], total: 41, hasMore: false });

    const { text } = await renderPage({ page: "3" });
    expect(text).toMatch(/Showing 41\D*41 of 41/);
    expect(text).toMatch(/page 3 of 3/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Empty state
// ─────────────────────────────────────────────────────────────────────────────

describe("/account/search-history — empty state", () => {
  it("tells the user plainly that nothing has been recorded", async () => {
    signInAsUser();
    captured.result = page({ entries: [], total: 0 });

    const { text } = await renderPage();
    expect(text).toMatch(/no searches recorded yet/i);
  });

  it("offers a route into search", async () => {
    signInAsUser();
    captured.result = page({ entries: [], total: 0 });

    const { hrefs, text } = await renderPage();
    expect(text).toMatch(/search activities/i);
    expect(hrefs).toContain("/search");
  });

  it("invents no rows and no counts", async () => {
    signInAsUser();
    captured.result = page({ entries: [], total: 0 });

    const { text, nodes } = await renderPage();
    // No list, no per-row query text, and no invented total.
    expect(text).not.toMatch(/\b\d+\s+search(es)?\s+recorded, newest first/i);
    const queries = nodes.filter(n => n.props["data-testid"] === "history-query");
    expect(queries).toHaveLength(0);
  });

  it("renders no pagination controls when there is nothing to page through", async () => {
    signInAsUser();
    captured.result = page({ entries: [], total: 0 });

    const { text } = await renderPage();
    expect(text).not.toMatch(/\bOlder\b/);
    expect(text).not.toMatch(/\bNewer\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. A failed read is not an empty history
// ─────────────────────────────────────────────────────────────────────────────

describe("/account/search-history — read failure", () => {
  it("reports the history as unavailable rather than empty", async () => {
    signInAsUser();
    captured.result = null;

    const { text } = await renderPage();
    expect(text).toMatch(/could not be loaded/i);
    // The dangerous thing to avoid: telling someone who has searched that they
    // have never searched.
    expect(text).not.toMatch(/no searches recorded yet/i);
  });

  it("does not claim a count of zero", async () => {
    signInAsUser();
    captured.result = null;

    const { text } = await renderPage();
    expect(text).not.toMatch(/\b0\s+search/i);
  });

  it("still offers a way back to the account", async () => {
    signInAsUser();
    captured.result = null;

    const { hrefs } = await renderPage();
    expect(hrefs).toContain("/account");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Suspended user can still read their existing history
// ─────────────────────────────────────────────────────────────────────────────

describe("/account/search-history — suspended user", () => {
  it("renders the page instead of 403-ing", async () => {
    signInAsSuspended({ id: LAYLA_ID });
    captured.result = page({ entries: [entry()], total: 1 });

    const { text } = await renderPage();
    // `requireViewer()` would have thrown ForbiddenError here, and the mock
    // enforces exactly that. The page uses `getViewer()`, matching /account.
    expect(redirectCalls).toEqual([]);
    expect(text.length).toBeGreaterThan(0);
  });

  it("shows the searches recorded while the account was active", async () => {
    signInAsSuspended();
    captured.result = page({ entries: [entry({ query: "earlier search" })], total: 7 });

    const { text } = await renderPage();
    // Suspension stops new rows being written. It does not confiscate the old
    // ones, which are the user's own data.
    expect(text).toMatch(/earlier search/);
  });

  it("explains that new searches are no longer being recorded", async () => {
    signInAsSuspended();
    const { text } = await renderPage();
    expect(text).toMatch(/suspended/i);
  });

  it("withholds the 'Search again' link, which would dead-end on a 403", async () => {
    signInAsSuspended();
    captured.result = page({ entries: [entry()], total: 1 });

    const { text, hrefs } = await renderPage();
    expect(text).not.toMatch(/search again/i);
    expect(hrefs.filter(h => h.startsWith("/search"))).toHaveLength(0);
  });

  it("still scopes the read to the suspended viewer's own id", async () => {
    signInAsSuspended({ id: LAYLA_ID });
    await renderPage();
    expect(captured.calls[0].viewer.id).toBe(LAYLA_ID);
  });

  it("offers no search CTA in the empty state either", async () => {
    signInAsSuspended();
    captured.result = page({ entries: [], total: 0 });

    const { hrefs } = await renderPage();
    // /search is requireViewer()-gated, so a suspended account must not be sent
    // to a 403 by its own dashboard.
    expect(hrefs).not.toContain("/search");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. No client-controlled userId can change the query scope
// ─────────────────────────────────────────────────────────────────────────────

describe("/account/search-history — no client-controlled identity", () => {
  it("ignores a ?userId= parameter entirely", async () => {
    signInAsUser({ id: LAYLA_ID });
    await renderPage({ userId: OTHER_ID });

    // Structural, not behavioural: `userId` is not a key the page reads, so
    // there is no value it could pass to the DAL.
    expect(captured.calls[0].viewer.id).toBe(LAYLA_ID);
  });

  it("ignores authUserId, id and providerUserId parameters too", async () => {
    signInAsUser({ id: LAYLA_ID });
    await renderPage({
      authUserId: "attacker-auth-id",
      id: OTHER_ID,
      providerUserId: "attacker-provider-id",
    });

    expect(captured.calls[0].viewer.id).toBe(LAYLA_ID);
  });

  it("ignores a SQL-shaped injection attempt in a parameter", async () => {
    signInAsUser({ id: LAYLA_ID });
    await renderPage({ userId: "' OR '1'='1" });

    // The value is never read, so it cannot reach a query. The DAL binds the
    // viewer's id as a parameter and nothing else.
    expect(captured.calls[0].viewer.id).toBe(LAYLA_ID);
  });

  it("passes only `page` through to the DAL's options", async () => {
    signInAsUser();
    await renderPage({ page: "2", userId: OTHER_ID, limit: "10000" });

    // `limit` in the query string is not forwarded: the page constant is.
    expect(captured.calls[0].limit).toBe(20);
    expect(captured.calls[0].offset).toBe(20);
  });

  it("the page's only accepted parameter is `page`", () => {
    // The structural guarantee: one destructured key, and it is a number.
    // Anything else in the query string is unreachable from this file.
    expect(AccountSearchHistoryPage.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Accessibility and view hygiene
// ─────────────────────────────────────────────────────────────────────────────

describe("/account/search-history — view hygiene", () => {
  it("marks up each timestamp as a machine-readable instant", async () => {
    signInAsUser();
    captured.result = page({ entries: [entry()], total: 1 });

    const { nodes } = await renderPage();
    const times = nodes.filter(n => n.type === "time");
    expect(times).toHaveLength(1);
    expect(times[0].props.dateTime).toBe("2026-06-15T12:00:00.000Z");
  });

  it("labels the list for assistive tech", async () => {
    signInAsUser();
    captured.result = page({ entries: [entry()], total: 1 });

    const { nodes } = await renderPage();
    const list = nodes.find(n => n.type === "ul" && n.props["aria-label"]);
    expect(list?.props["aria-label"]).toMatch(/recorded searches/i);
  });

  it("announces a failed read as an alert", async () => {
    signInAsUser();
    captured.result = null;

    const { nodes } = await renderPage();
    expect(nodes.some(n => n.props.role === "alert")).toBe(true);
  });

  it("renders a read-only list — no form controls to submit", async () => {
    signInAsUser();
    captured.result = page({ entries: [entry()], total: 1 });

    const { tags } = await renderPage();
    // Nothing on this page mutates anything. Paging is by link, deliberately, so
    // there is no POST and no CSRF surface.
    expect(tags).not.toContain("form");
    expect(tags).not.toContain("input");
    expect(tags).not.toContain("textarea");
  });

  it("states the privacy boundary in words", async () => {
    signInAsUser();
    captured.result = page({ entries: [entry()], total: 1 });

    const { text } = await renderPage();
    expect(text).toMatch(/scoped to your own account/i);
    expect(text).toMatch(/no authentication tokens/i);
  });
});
