import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * THE REGRESSION: candidate search SQL was assembled by string concatenation.
 *
 * `fetchCandidates` used `sqlLit`/`likeLit` to inline user terms into a giant
 * `sql.raw(...)` statement. Under Postgres' default `standard_conforming_strings
 * = on` that was not directly injectable — backslash escapes are inert and `'`
 * was doubled — but it was fragile: a LIKE pattern ending in an unescaped
 * backslash triggers `LIKE pattern must not end with escape character`, and any
 * future caller that forgot to route a value through the helpers would inject.
 *
 * The fix binds every user-derived value as a query parameter (`$1`, `$2`, ...).
 * This test asserts the property that actually matters: user input appears in
 * `params`, never in the SQL text, and characters with SQL/LIKE meaning
 * (`'`, `\`, `%`, `_`) survive as ordinary data without error.
 */

const { dbMock } = vi.hoisted(() => ({
  dbMock: { select: vi.fn(), selectDistinct: vi.fn(), execute: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { search } from "@/lib/search/engine";

const dialect = new PgDialect();

interface Rendered {
  sql: string;
  params: unknown[];
}

/** Run a search and return the rendered candidate UNION statement + its params. */
async function captureUnionQuery(q: string): Promise<Rendered> {
  let captured: Rendered | null = null;
  dbMock.execute.mockImplementation((arg: unknown) => {
    const rendered = dialect.sqlToQuery(
      arg as Parameters<PgDialect["sqlToQuery"]>[0]
    );
    if (rendered.sql.includes("UNION ALL")) {
      captured = { sql: rendered.sql, params: rendered.params as unknown[] };
    }
    return Promise.resolve([]);
  });

  await search({ q, limit: 10 });
  if (!captured) throw new Error("no UNION statement was executed");
  return captured;
}

describe("candidate search SQL is parameterized", () => {
  it("binds the search phrase instead of inlining it", async () => {
    const { sql, params } = await captureUnionQuery("general trading");

    expect(sql).toMatch(/\$\d+/);
    expect(params).toContain("general trading");
    expect(params).toContain("%general trading%");
    expect(sql).not.toContain("general trading");
  });

  it("carries a SQL-looking quote block as data, not syntax", async () => {
    const q = "a' OR 1=1"; // <= 20 chars, so it reaches the exact-code branch too
    const { sql, params } = await captureUnionQuery(q);

    expect(sql).not.toContain("OR 1=1");
    expect(sql).not.toContain("a' OR 1=1");
    expect(params).toContain(q);
  });

  it("does not choke on a trailing backslash", async () => {
    const q = "abc\\";
    const { sql, params } = await captureUnionQuery(q);

    // The old string-builder could emit `ILIKE '%abc\%'` -> 22025.
    expect(sql).not.toContain("abc\\");
    expect(params).toContain(q);
  });

  it("keeps LIKE wildcards in % and _ as literal parameter data", async () => {
    const q = "100%_trading";
    const { sql, params } = await captureUnionQuery(q);

    expect(sql).not.toContain("100%_trading");
    expect(params).toContain(q);
  });

  it("does not use sql.raw for any user-derived value", async () => {
    const q = "trading')--";
    const { sql, params } = await captureUnionQuery(q);

    expect(sql).not.toContain(")--");
    expect(params).toContain(q);
  });
});
