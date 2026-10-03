import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * THE REGRESSION: SQLSTATE 42601 in the candidate UNION.
 *
 * WHAT HAPPENED
 *   `GET /search?q=general%20trading` returned
 *   "Something went wrong running your search. Please try again." for every
 *   query. The single UNION ALL candidate query built by `fetchCandidates`
 *   failed with:
 *
 *     PostgresError: each UNION query must have the same number of columns
 *     code: '42601'
 *     at fetchCandidates (src/lib/search/engine.ts)
 *
 *   Every candidate branch selects from one shared list, `CANDIDATE_SELECT`.
 *   When `activities.isic_code AS a_isic_code` was added to that list, the
 *   availability branch — a hand-written parallel list of `NULL::<type>` columns
 *   that Postgres needs in order to union a row of pure-NULL activity columns
 *   with a real jurisdiction row — was not updated. It had 23 columns where
 *   `CANDIDATE_SELECT` had 24.
 *
 *   Postgres rejects the whole statement, so this was not a degraded result: no
 *   branch ran at all. `searchUnified` always passes `includeAvailability: true`,
 *   so `/search` and `/api/activities/search` failed on every single query, while
 *   anything using the narrower `search()` path stayed green. That asymmetry is
 *   why the unit tests did not catch it.
 *
 * WHY THIS TEST IS STRUCTURAL RATHER THAN A LIVE QUERY
 *   A test that needs a live Postgres cannot run in CI, and the suite here is
 *   database-free by design. The defect is entirely contained in the shape of
 *   the SQL string, so this asserts the shape: it captures the exact statement
 *   the engine hands to `db.execute` and checks that every UNION branch selects
 *   the same columns, in the same order, under the same aliases. That is
 *   precisely the condition Postgres rejects with 42601, so this fails if and
 *   only if the query would fail.
 *
 *   It also pins the alignment by alias, not just by count. A count-only check
 *   would pass on a list with the right number of columns in the wrong order,
 *   which silently mis-assigns every value after the mistake.
 */

const { dbMock } = vi.hoisted(() => ({
  dbMock: { select: vi.fn(), selectDistinct: vi.fn(), execute: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { searchUnified, search } from "@/lib/search/engine";

/** Split a SELECT list on commas that are not nested inside parentheses. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

interface ParsedColumn {
  alias: string;
  expr: string;
}

function parseColumns(selectList: string): ParsedColumn[] {
  return splitTopLevel(selectList).map(entry => {
    const m = /([\s\S]+?)\s+AS\s+(\w+)$/i.exec(entry);
    return { alias: m ? m[2] : "<<unaliased>>", expr: (m ? m[1] : entry).trim() };
  });
}

/**
 * Pull the `SELECT ... FROM ...` list out of one parenthesised UNION branch.
 *
 * Redundant wrapping is expected and is not an error: the availability branch is
 * itself written as `(SELECT DISTINCT ...)` in the source and then wrapped again
 * by `branches.map(b => `(${b})`)`, so it arrives as `((SELECT DISTINCT ...))`.
 * Both layers must come off before the list can be read.
 */
function branchSelectList(branch: string): string | null {
  let body = branch.trim();
  while (body.startsWith("(")) body = body.slice(1).trimStart();
  while (body.endsWith(")")) body = body.slice(0, -1).trimEnd();
  const m = /^\s*SELECT\s+(?:DISTINCT\s+)?([\s\S]+?)\s+FROM\s/i.exec(body);
  return m ? m[1] : null;
}

/** Every top-level `(SELECT ...)` branch of the assembled UNION statement. */
function unionBranches(unionSql: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < unionSql.length; i++) {
    const ch = unionSql[i];
    if (ch === "(") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0 && start >= 0) {
        branches.push(unionSql.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return branches;
}

/** The dialect used only to render the engine's sql.raw() into real SQL text. */
const dialect = new PgDialect();

/**
 * Render the argument the engine passed to `db.execute` into the SQL string
 * Postgres would actually receive, using Drizzle's own Pg dialect. Reading the
 * real rendered statement is what makes this a test of the query rather than of
 * an internal object shape.
 */
function renderSql(arg: unknown): string {
  const rendered = dialect.sqlToQuery(
    arg as Parameters<PgDialect["sqlToQuery"]>[0]
  );
  return rendered.sql;
}

/** Run a unified search and return the SQL the engine actually sent to Postgres. */
async function captureUnifiedSql(query = "general trading"): Promise<string> {
  let captured = "";
  dbMock.execute.mockImplementation((arg: unknown) => {
    captured = renderSql(arg);
    return Promise.resolve([]);
  });

  await searchUnified({ q: query, limit: 10, offset: 0, groupLimit: 10 });
  return captured;
}

describe("candidate UNION column alignment (SQLSTATE 42601 regression)", () => {
  beforeEach(() => {
    dbMock.execute.mockReset();
  });

  it("assembles a UNION statement at all", async () => {
    const sql = await captureUnifiedSql();
    expect(sql).toContain("UNION ALL");
  });

  it("selects the same number of columns in every branch", async () => {
    // The literal Postgres error: "each UNION query must have the same number
    // of columns".
    const sql = await captureUnifiedSql();
    const counts = unionBranches(sql).map(b => {
      const list = branchSelectList(b);
      expect(list, `branch is not a plain SELECT: ${b.slice(0, 80)}`).not.toBeNull();
      return parseColumns(list!).length;
    });

    expect(counts.length).toBeGreaterThan(1);
    expect(new Set(counts).size).toBe(1);
  });

  it("selects the same aliases in the same order in every branch", async () => {
    // A count-only check would not catch a same-length list in the wrong order,
    // which silently shifts every value after the mistake.
    const sql = await captureUnifiedSql();
    const aliasLists = unionBranches(sql).map(b => {
      const list = branchSelectList(b)!;
      return parseColumns(list).map(c => c.alias);
    });

    const reference = aliasLists[0];
    for (const aliases of aliasLists.slice(1)) {
      expect(aliases).toEqual(reference);
    }
  });

  it("keeps the jurisdiction columns the availability branch exists to provide", async () => {
    // The availability branch is not filler: it supplies j_* so the response can
    // report which jurisdictions have no data. It NULLs the a_/lt_/s_ columns.
    const sql = await captureUnifiedSql();
    const branches = unionBranches(sql);

    const availability = branches.find(
      b => branchSelectList(b)?.includes("a_isic_code") && !/activities\.id/.test(b)
    );
    expect(availability, "availability branch not found").toBeTruthy();

    const cols = parseColumns(branchSelectList(availability!)!);
    const byAlias = new Map(cols.map(c => [c.alias, c.expr]));

    // Real jurisdiction columns ...
    expect(byAlias.get("j_id")).toBe("jurisdictions.id");
    expect(byAlias.get("j_name")).toBe("jurisdictions.name");
    expect(byAlias.get("j_slug")).toBe("jurisdictions.slug");
    expect(byAlias.get("j_emirate")).toBe("jurisdictions.emirate");
    expect(byAlias.get("j_jurisdiction_type")).toBe("jurisdictions.jurisdiction_type");

    // ... and NULLed activity columns, one per alias, all present.
    for (const [alias, expr] of byAlias) {
      if (alias.startsWith("a_")) {
        expect(expr, `${alias} must be a NULL placeholder`).toMatch(/^NULL::/);
      }
    }
    expect([...byAlias.keys()].filter(a => a.startsWith("a_")).length).toBeGreaterThan(0);
  });

  it("the specific column that was missing, a_isic_code, is in the availability branch", async () => {
    // Names the regression outright so a future failure points straight here.
    const sql = await captureUnifiedSql();
    const availability = unionBranches(sql).find(
      b => branchSelectList(b)?.includes("a_isic_code") && !/activities\.id/.test(b)
    );
    const aliases = parseColumns(branchSelectList(availability!)!).map(c => c.alias);
    expect(aliases).toContain("a_isic_code");
  });

  it("carries a_isic_code through to the activity the engine returns", async () => {
    // The end-to-end consequence of the placeholder: isicCode is populated on
    // results, because mapCandidateRow reads a_isic_code.
    dbMock.execute.mockImplementation(() =>
      Promise.resolve([
        {
          a_id: "act-1",
          a_official_name: "General Trading",
          a_normalized_name: "general trading",
          a_activity_code: "5219-04",
          a_isic_code: "4610",
          a_description: null,
          a_official_category: null,
          a_activity_group: null,
          a_approval_signal: "no_signal",
          a_approval_status: "unknown",
          a_verification_status: "not_checked",
          a_last_verified: null,
          j_id: "jur-1",
          j_name: "Dubai",
          j_slug: "dubai",
          j_emirate: "dubai",
          j_jurisdiction_type: "emirate",
          lt_id: null,
          lt_name: null,
          lt_code: null,
          s_id: null,
          s_url: null,
          s_title: null,
          s_last_verified: null,
        },
      ])
    );

    const res = await searchUnified({ q: "general trading", limit: 10, offset: 0, groupLimit: 10 });
    expect(res.results[0]?.activity?.isicCode).toBe("4610");
  });

  it("leaves the narrower search() path unaffected by the availability branch", async () => {
    // `search()` does not request availability, so it never adds that branch.
    // Pinning this documents why the bug was invisible to the unit tests: only
    // the unified path could fail.
    let captured = "";
    dbMock.execute.mockImplementation((arg: unknown) => {
      captured = renderSql(arg);
      return Promise.resolve([]);
    });

    await search({ q: "general trading", limit: 10 });
    expect(captured).toContain("UNION ALL");
    expect(captured).not.toContain("NULL::uuid AS a_id");
  });
});