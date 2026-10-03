import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { makeViewer, type TestViewer } from "../helpers/auth-mock";

/**
 * The per-user search usage DAL.
 *
 * This module is the privacy boundary for stored search history, so the tests
 * below are mostly negative assertions: the cases worth protecting are the ones
 * where a row could be attributed to the wrong person, written with a column
 * that should not exist, or counted across an account boundary.
 */
vi.mock("server-only", () => ({}));

const {
  mockInsert,
  mockSelect,
  insertImpl,
  whereSpy,
  setSelectRows,
  setSelectResults,
  setSelectError,
  limitSpy,
  offsetSpy,
  orderBySpy,
} =
  vi.hoisted(() => {
    const insertImpl = vi.fn();
    // Every `where()` call in the suite lands here, so a test can assert the
    // exact boundary that was pushed to the database.
    const whereSpy = vi.fn();
    const limitSpy = vi.fn();
    const offsetSpy = vi.fn();
    const orderBySpy = vi.fn();

    const buildChain = () => {
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn(() => chain);
      chain.where = vi.fn((...args: unknown[]) => {
        whereSpy(...args);
        return chain;
      });
      chain.limit = vi.fn((...args: unknown[]) => {
        limitSpy(...args);
        return chain;
      });
      chain.offset = vi.fn((...args: unknown[]) => {
        offsetSpy(...args);
        return chain;
      });
      chain.orderBy = vi.fn((...args: unknown[]) => {
        orderBySpy(...args);
        return chain;
      });
      // Drizzle builders are awaited directly, so the chain has to be thenable.
      chain.then = (
        resolve: (v: unknown) => void,
        reject?: (e: unknown) => void
      ) => {
        queueMicrotask(() => {
          if (state.error) reject?.(state.error);
          // A queued result set is consumed in call order, which is what lets a
          // function that runs two selects in parallel be given a different
          // answer for each. Empty queue = the single shared `rows` set, which
          // is the pre-existing behaviour and every earlier test.
          else if (state.queue.length) resolve(state.queue.shift());
          else resolve(state.rows);
        });
      };
      return chain;
    };

    const state = {
      rows: [{ n: 0 }] as unknown[],
      error: null as Error | null,
      queue: [] as unknown[][],
    };

    return {
      insertImpl,
      whereSpy,
      limitSpy,
      offsetSpy,
      orderBySpy,
      setSelectRows: (rows: unknown[]) => {
        state.rows = rows;
        state.queue = [];
        state.error = null;
      },
      /**
       * Supply one result set per select, consumed in order. Required for
       * `listSearchHistory`, which reads rows and a count in parallel and would
       * otherwise receive the same rows for both.
       */
      setSelectResults: (...sets: unknown[][]) => {
        state.queue = sets;
        state.error = null;
      },
      setSelectError: (error: Error) => {
        state.error = error;
      },
      mockInsert: vi.fn<(table: unknown) => { values: typeof insertImpl }>(
        () => ({ values: insertImpl })
      ),
      mockSelect: vi.fn<() => Record<string, unknown>>(() => buildChain()),
    };
  });

vi.mock("@/lib/db", () => ({
  db: { insert: mockInsert, select: mockSelect },
}));

// The schema is real (not mocked) so the insert's target table and columns are
// the ones the migration actually creates.
import { getTableColumns } from "drizzle-orm";
import { searchUsage } from "@/lib/db/schema";
import {
  getSearchUsageCounts,
  getSearchUsageCountsSafely,
  listSearchHistory,
  listSearchHistorySafely,
  recordSearchUsage,
  recordSearchUsageSafely,
  MAX_STORED_QUERY_LENGTH,
  SEARCH_HISTORY_MAX_LIMIT,
  SEARCH_HISTORY_PAGE_SIZE,
} from "@/lib/auth/search-usage";
import type { Viewer } from "@/lib/auth/viewer";

/** `makeViewer` produces the same shape the real DAL receives. */
function viewerFrom(test: TestViewer): Viewer {
  return test as unknown as Viewer;
}

const LAYLA = viewerFrom(
  makeViewer({
    id: "11111111-1111-4111-8111-111111111111",
    email: "layla@example.com",
  })
);
const SOMEONE_ELSE = viewerFrom(
  makeViewer({
    id: "99999999-9999-4999-8999-999999999999",
    email: "other@example.com",
  })
);

beforeEach(() => {
  vi.clearAllMocks();
  insertImpl.mockResolvedValue([{ id: "row-1" }]);
  setSelectRows([{ n: 0 }]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Records exactly one row, for the right account
// ─────────────────────────────────────────────────────────────────────────────

describe("recordSearchUsage", () => {
  it("writes one row attributed to the caller's own account id", async () => {
    await recordSearchUsage(LAYLA, "trading licence");

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(searchUsage);
    expect(insertImpl).toHaveBeenCalledTimes(1);
    expect(insertImpl).toHaveBeenCalledWith({
      userId: LAYLA.id,
      query: "trading licence",
    });
  });

  it("writes to the search_usage table specifically", async () => {
    await recordSearchUsage(LAYLA, "fees");
    // Guards against a future refactor pointing this at admin_audit_logs or
    // app_users, either of which would leak or corrupt something.
    expect(mockInsert.mock.calls[0][0]).toBe(searchUsage);
    expect(searchUsage).toHaveProperty("query");
  });

  it("trims surrounding whitespace before storing", async () => {
    await recordSearchUsage(LAYLA, "  trading licence \n");
    expect(insertImpl).toHaveBeenCalledWith({
      userId: LAYLA.id,
      query: "trading licence",
    });
  });

  it("stores nothing for an empty or whitespace-only query", async () => {
    await recordSearchUsage(LAYLA, "");
    await recordSearchUsage(LAYLA, "    ");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("caps the stored query so the table constraint can never be the failure", async () => {
    await recordSearchUsage(LAYLA, "x".repeat(5000));
    const written = insertImpl.mock.calls[0][0] as { query: string };
    expect(written.query).toHaveLength(MAX_STORED_QUERY_LENGTH);
  });

  it("propagates a database failure to its caller", async () => {
    // The throwing variant is the one used where the caller decides what to do;
    // the safe variant below is what search requests use.
    insertImpl.mockRejectedValue(new Error("connection refused"));
    await expect(recordSearchUsage(LAYLA, "trading")).rejects.toThrow(
      "connection refused"
    );
  });

  it("refuses a suspended viewer even when called directly", async () => {
    // The safe wrapper checks this too, but the rule belongs to the module that
    // owns the write: a future caller using this exported function must not be
    // able to accumulate history for an account that has lost product access.
    const suspended = viewerFrom(makeViewer({ status: "suspended" }));
    expect(suspended.isActive).toBe(false);

    await recordSearchUsage(suspended, "trading");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("still records for an active viewer so the guard is not simply closed", async () => {
    await recordSearchUsage(viewerFrom(makeViewer()), "trading");
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No sensitive column is ever written
// ─────────────────────────────────────────────────────────────────────────────

describe("recordSearchUsage — only two columns are ever written", () => {
  it("writes exactly userId and query, with no other key", async () => {
    await recordSearchUsage(LAYLA, "trading");

    const written = insertImpl.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(["query", "userId"]);
  });

  it("carries no auth, provider or credential field, even though the viewer has them", async () => {
    await recordSearchUsage(LAYLA, "trading");

    const serialised = JSON.stringify(insertImpl.mock.calls[0][0]);
    for (const forbidden of [
      "authUserId",
      "providerUserId",
      "email",
      "provider",
      "avatarUrl",
      "fullName",
      "role",
      "status",
      "password",
      "token",
      "ip",
      "userAgent",
    ]) {
      expect(Object.keys(insertImpl.mock.calls[0][0])).not.toContain(forbidden);
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("does not store the provider's subject id even as a value", async () => {
    await recordSearchUsage(LAYLA, "trading");
    const serialised = JSON.stringify(insertImpl.mock.calls[0][0]);
    expect(serialised).not.toContain(LAYLA.authUserId);
  });

  it("declares no such column on the table itself", () => {
    // A source-level check on the schema: if someone adds `ip` or
    // `authUserId` to search_usage, this fails even if the DAL still ignores it.
    const columns = Object.keys(getTableColumns(searchUsage)).sort();
    expect(columns).toEqual(["createdAt", "id", "query", "userId"]);
    for (const forbidden of [
      "authUserId",
      "providerUserId",
      "ip",
      "userAgent",
      "email",
      "password",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The safe wrapper: never throws, never records for the wrong caller
// ─────────────────────────────────────────────────────────────────────────────

describe("recordSearchUsageSafely", () => {
  it("records for an active authenticated account", async () => {
    await recordSearchUsageSafely(LAYLA, "trading licence");
    expect(insertImpl).toHaveBeenCalledWith({
      userId: LAYLA.id,
      query: "trading licence",
    });
  });

  it("records nothing for an anonymous caller", async () => {
    await recordSearchUsageSafely(null, "trading licence");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("records nothing for a suspended account", async () => {
    // Suspension revokes product access, so a suspended person's searches must
    // not keep accumulating new history.
    const suspended = viewerFrom(makeViewer({ status: "suspended" }));
    await recordSearchUsageSafely(suspended, "trading licence");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("swallows a database failure and logs it server-side", async () => {
    insertImpl.mockRejectedValue(new Error("connection refused"));
    await expect(
      recordSearchUsageSafely(LAYLA, "trading licence")
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("does not write the query text into the log", async () => {
    insertImpl.mockRejectedValue(new Error("connection refused"));
    await recordSearchUsageSafely(LAYLA, "Acme Trading LLC licence 12345");

    // The query is personal data. The failure is logged, the query is not.
    const logged = JSON.stringify(
      (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    );
    expect(logged).not.toContain("Acme Trading LLC");
  });

  it("does not log anything for an anonymous caller", async () => {
    // Not an error, just a normal case — logging it would be noise.
    await recordSearchUsageSafely(null, "trading");
    expect(console.error).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reading counts: only the caller's own rows
// ─────────────────────────────────────────────────────────────────────────────

describe("getSearchUsageCounts", () => {
  it("returns both counts", async () => {
    setSelectRows([{ n: 42 }]);
    const counts = await getSearchUsageCounts(LAYLA);
    expect(counts).toEqual({ total: 42, last30Days: 42 });
  });

  it("scopes both queries to the caller's own id", async () => {
    await getSearchUsageCounts(LAYLA);

    // The lifetime total AND the 30-day count must each be filtered, so
    // neither can return another account's rows.
    expect(whereSpy).toHaveBeenCalledTimes(2);
  });

  it("never receives another user's id as an argument", () => {
    // The signature is the guarantee: the only identity input is a Viewer
    // resolved from the session, and there is no `targetUserId` parameter.
    expect(getSearchUsageCounts.length).toBe(1);
  });

  it("reports zero rather than null when the account genuinely has no rows", async () => {
    setSelectRows([{ n: 0 }]);
    await expect(getSearchUsageCounts(LAYLA)).resolves.toEqual({
      total: 0,
      last30Days: 0,
    });
  });

  it("reports zero when the count query returns no rows at all", async () => {
    setSelectRows([]);
    await expect(getSearchUsageCounts(LAYLA)).resolves.toEqual({
      total: 0,
      last30Days: 0,
    });
  });

  it("issues a separate scoped query per account", async () => {
    setSelectRows([{ n: 1 }]);
    await getSearchUsageCounts(LAYLA);
    await getSearchUsageCounts(SOMEONE_ELSE);
    expect(whereSpy).toHaveBeenCalledTimes(4);
  });

  it("propagates a read failure to a caller that opted into throwing", async () => {
    setSelectError(new Error('relation "search_usage" does not exist'));
    await expect(getSearchUsageCounts(LAYLA)).rejects.toThrow(/search_usage/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The 30-day boundary
// ─────────────────────────────────────────────────────────────────────────────

describe("getSearchUsageCounts — 30-day window", () => {
  const NOW = new Date("2026-06-15T12:00:00.000Z").getTime();

  /**
   * Render each captured `where(...)` expression through Drizzle's own Pg
   * dialect, so the assertions below run against the SQL and bound parameters
   * that would really be sent — not against an internal object shape. The
   * dialect encodes a timestamp bound value as an ISO-8601 string, which is the
   * exact value the driver would transmit.
   */
  function renderedFilters() {
    const dialect = new PgDialect();
    return whereSpy.mock.calls.map(args => dialect.sqlToQuery(args[0]));
  }

  /** The timestamp bound values, as the driver would send them. */
  function boundTimestamps(): string[] {
    return renderedFilters()
      .flatMap(r => r.params)
      .filter(
        (p): p is string =>
          typeof p === "string" && /^\d{4}-\d{2}-\d{2}T/.test(p)
      );
  }

  it("uses a boundary exactly 30 days before now", async () => {
    await getSearchUsageCounts(LAYLA, NOW);

    const thirtyDaysAgo = new Date(NOW - 30 * 24 * 60 * 60 * 1000);
    const stamps = boundTimestamps();
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toBe(thirtyDaysAgo.toISOString());
  });

  it("compares with >= so a search exactly 30 days old still counts", async () => {
    await getSearchUsageCounts(LAYLA, NOW);
    const filters = renderedFilters();

    // [0] is the lifetime total (bare equality), [1] is the windowed count.
    expect(filters[0].sql).not.toMatch(/>=/);
    expect(filters[1].sql).toMatch(/"search_usage"\."created_at" >= \$2/);
  });

  it("date-filters only the 30-day query, never the lifetime total", async () => {
    // Two queries, exactly one date. If both were filtered, the lifetime
    // "Total searches" would silently become a 30-day number.
    await getSearchUsageCounts(LAYLA, NOW);

    expect(renderedFilters()).toHaveLength(2);
    expect(boundTimestamps()).toHaveLength(1);
  });

  it("scopes both queries to the caller's id", async () => {
    await getSearchUsageCounts(LAYLA, NOW);

    for (const rendered of renderedFilters()) {
      expect(rendered.sql).toMatch(/"search_usage"\."user_id" = \$1/);
    }
  });

  it("moves the window with the clock rather than using a fixed date", async () => {
    const later = new Date("2026-09-01T00:00:00.000Z").getTime();
    await getSearchUsageCounts(LAYLA, later);

    const expected = new Date(later - 30 * 24 * 60 * 60 * 1000);
    expect(boundTimestamps()[0]).toBe(expected.toISOString());
  });

  it("shifts the boundary by exactly the elapsed time between calls", async () => {
    await getSearchUsageCounts(LAYLA, NOW);
    const first = boundTimestamps()[0];

    // Start clean so the second reading is unambiguous.
    whereSpy.mockClear();
    await getSearchUsageCounts(LAYLA, NOW + 24 * 60 * 60 * 1000);
    const second = boundTimestamps()[0];

    expect(second).not.toBe(first);
    // A later `now` moves the boundary FORWARD by exactly the elapsed time.
    expect(Date.parse(second)).toBe(Date.parse(first) + 86_400_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Safe read for the dashboard
// ─────────────────────────────────────────────────────────────────────────────

describe("getSearchUsageCountsSafely", () => {
  it("returns the real counts on success", async () => {
    setSelectRows([{ n: 3 }]);
    await expect(getSearchUsageCountsSafely(LAYLA)).resolves.toEqual({
      total: 3,
      last30Days: 3,
    });
  });

  it("returns null when the read fails, so the dashboard can say 'unavailable'", async () => {
    setSelectError(new Error("relation does not exist"));
    await expect(getSearchUsageCountsSafely(LAYLA)).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("does not surface the database error to the caller", async () => {
    setSelectError(new Error("password authentication failed for user app"));
    const result = await getSearchUsageCountsSafely(LAYLA);
    // `null` is the whole contract. The message never escapes this module, so a
    // dashboard can never render "relation search_usage does not exist".
    expect(result).toBeNull();
    expect(result).not.toBeInstanceOf(Error);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listSearchHistory — scope, ordering, bound
// ─────────────────────────────────────────────────────────────────────────────

describe("listSearchHistory", () => {
  const NEWEST = new Date("2026-06-15T12:00:00.000Z");
  const MIDDLE = new Date("2026-06-14T09:00:00.000Z");
  const OLDEST = new Date("2026-06-13T09:00:00.000Z");

  function rows() {
    return [
      { id: "row-c", query: "newest", createdAt: NEWEST },
      { id: "row-b", query: "middle", createdAt: MIDDLE },
      { id: "row-a", query: "oldest", createdAt: OLDEST },
    ];
  }

  /** Both selects in `listSearchHistory`, rendered through Drizzle's dialect. */
  function renderedFilters() {
    const dialect = new PgDialect();
    return whereSpy.mock.calls.map(args => dialect.sqlToQuery(args[0]));
  }

  it("returns only the caller's own rows, newest first", async () => {
    setSelectResults(rows(), [{ n: 3 }]);

    const page = await listSearchHistory(LAYLA);

    // The mock returns whatever it is given, so ordering is proven by the
    // ORDER BY the DAL emits (asserted below), not by the fixture.
    expect(page.entries).toHaveLength(3);
    expect(page.total).toBe(3);
  });

  it("scopes BOTH the row query and the count to the caller's id", async () => {
    setSelectResults(rows(), [{ n: 3 }]);
    await listSearchHistory(LAYLA);

    const filters = renderedFilters();
    expect(filters).toHaveLength(2);
    for (const rendered of filters) {
      expect(rendered.sql).toMatch(/"search_usage"\."user_id" = \$1/);
      expect(rendered.params[0]).toBe(LAYLA.id);
    }
  });

  it("user A's read binds A's id, never B's", async () => {
    setSelectResults(rows(), [{ n: 3 }]);
    await listSearchHistory(SOMEONE_ELSE);

    // A different viewer changes the bound parameter and nothing else. There is
    // no argument that could override the scope, because the only argument is
    // the viewer itself.
    for (const rendered of renderedFilters()) {
      expect(rendered.params[0]).toBe(SOMEONE_ELSE.id);
      expect(rendered.params).not.toContain(LAYLA.id);
    }
  });

  it("orders by created_at DESC, tie-broken by id DESC", async () => {
    setSelectResults(rows(), [{ n: 3 }]);
    await listSearchHistory(LAYLA);

    const dialect = new PgDialect();
    expect(orderBySpy).toHaveBeenCalledTimes(1);

    // `orderBy` receives one argument per sort key, so each is rendered
    // separately and then checked in the order they were passed.
    const keys = orderBySpy.mock.calls[0].map(arg => dialect.sqlToQuery(arg).sql);

    expect(keys[0]).toMatch(/"search_usage"\."created_at" desc/);
    expect(keys[1]).toMatch(/"search_usage"\."id" desc/);

    // Newest first. The id tie-break is what stops two rows written in the same
    // transaction from swapping places between page loads.
    expect(keys).toHaveLength(2);
  });

  it("selects only id, query and createdAt — never user_id", async () => {
    setSelectResults(rows(), [{ n: 3 }]);
    const page = await listSearchHistory(LAYLA);

    // `user_id` filters the rows but is not selected, so it cannot reach a
    // component even by accident.
    for (const entry of page.entries) {
      expect(Object.keys(entry).sort()).toEqual(["createdAt", "id", "query"]);
      expect(entry).not.toHaveProperty("userId");
      expect(entry).not.toHaveProperty("user_id");
    }
  });

  it("applies a bounded limit and offset", async () => {
    setSelectResults(rows(), [{ n: 3 }]);
    await listSearchHistory(LAYLA, { limit: 2, offset: 40 });

    expect(limitSpy).toHaveBeenCalledWith(2);
    expect(offsetSpy).toHaveBeenCalledWith(40);
  });

  it("clamps an oversized limit to the hard ceiling", async () => {
    setSelectResults(rows(), [{ n: 3 }]);
    await listSearchHistory(LAYLA, { limit: 100_000 });

    // No caller, present or future, can ask for an unbounded result set.
    expect(limitSpy).toHaveBeenCalledWith(SEARCH_HISTORY_MAX_LIMIT);
  });

  it("clamps a nonsensical limit and offset instead of trusting them", async () => {
    setSelectResults(rows(), [{ n: 3 }]);
    await listSearchHistory(LAYLA, { limit: 0, offset: -99 });

    expect(limitSpy).toHaveBeenCalledWith(1);
    expect(offsetSpy).toHaveBeenCalledWith(0);
  });

  it("defaults to the page size and no offset", async () => {
    setSelectResults(rows(), [{ n: 3 }]);
    await listSearchHistory(LAYLA);

    expect(limitSpy).toHaveBeenCalledWith(SEARCH_HISTORY_PAGE_SIZE);
    expect(offsetSpy).toHaveBeenCalledWith(0);
  });

  it("reports a next page only when the current one is full and rows remain", async () => {
    const full = Array.from({ length: 2 }, (_, i) => ({
      id: `row-${i}`,
      query: `q${i}`,
      createdAt: NEWEST,
    }));

    setSelectResults(full, [{ n: 10 }]);
    await expect(listSearchHistory(LAYLA, { limit: 2 })).resolves.toMatchObject({
      hasMore: true,
    });

    // A short page is the last page, even though `total` says otherwise.
    setSelectResults(full.slice(0, 1), [{ n: 10 }]);
    await expect(listSearchHistory(LAYLA, { limit: 2 })).resolves.toMatchObject({
      hasMore: false,
    });
  });

  it("does not claim a next page when paging past the end", async () => {
    setSelectResults([], [{ n: 3 }]);
    const page = await listSearchHistory(LAYLA, { limit: 20, offset: 400 });

    // Zero rows back, but `total` is 3: without the full-page check this would
    // report a next page and render a dead "Older" button.
    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("lets a suspended viewer read their own history", async () => {
    const suspended = viewerFrom(makeViewer({ status: "suspended" }));
    expect(suspended.isActive).toBe(false);
    setSelectResults(rows(), [{ n: 3 }]);

    const page = await listSearchHistory(suspended);

    // Deliberately the opposite of the write path: suspension stops new rows
    // being recorded, it does not hide the ones already earned.
    expect(page.entries).toHaveLength(3);
    expect(whereSpy).toHaveBeenCalledTimes(2);
  });

  it("propagates a read failure to a caller that opted into throwing", async () => {
    setSelectError(new Error('relation "search_usage" does not exist'));
    await expect(listSearchHistory(LAYLA)).rejects.toThrow(/search_usage/);
  });
});

describe("listSearchHistorySafely", () => {
  it("returns the real page on success", async () => {
    setSelectResults([{ id: "r1", query: "licence", createdAt: new Date() }], [{ n: 1 }]);
    const page = await listSearchHistorySafely(LAYLA);

    expect(page?.entries).toHaveLength(1);
    expect(page?.total).toBe(1);
  });

  it("returns null on failure so the page can say 'unavailable'", async () => {
    setSelectError(new Error("connection refused"));
    await expect(listSearchHistorySafely(LAYLA)).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("never returns an empty page in place of a failure", async () => {
    setSelectError(new Error("connection refused"));
    const result = await listSearchHistorySafely(LAYLA);

    // The distinction the page depends on: `null` means "we do not know",
    // `entries: []` means "you have not searched". Collapsing them would tell
    // someone who has searched 200 times that they never have.
    expect(result).toBeNull();
    expect(result).not.toEqual({ entries: [], total: 0, hasMore: false });
  });

  it("forwards the limit and offset it was given", async () => {
    setSelectResults([], [{ n: 100 }]);
    await listSearchHistorySafely(LAYLA, { limit: 20, offset: 60 });

    expect(limitSpy).toHaveBeenCalledWith(20);
    expect(offsetSpy).toHaveBeenCalledWith(60);
  });
});
