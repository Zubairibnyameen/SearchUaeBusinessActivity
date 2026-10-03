import { describe, it, expect } from "vitest";

import { isUuid, parseUuid, uuidFilter } from "@/lib/db/uuid";

/**
 * The shared `uuid` shape guard.
 *
 * WHY THIS SUITE EXISTS
 *   This regex was copy-pasted into five page modules and `parseUserId`. They had
 *   already drifted: some normalised case, some did not. Two admin routes had
 *   the guard and `/admin/research` did not, so `?jurisdiction=abc` reached
 *   Postgres as `invalid input syntax for type uuid` — a 500 rather than an
 *   ignored filter. One definition, now covered.
 *
 * WHAT IS AND IS NOT BEING ASSERTED
 *   This is a *syntax* check. It must never become an existence check: the tests
 *   below deliberately pass well-formed ids that do not exist and require them
 *   to be accepted, so nobody "improves" this into a lookup or a reachability
 *   probe.
 */

const VALID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("isUuid", () => {
  it("accepts a canonical lowercase uuid", () => {
    expect(isUuid(VALID)).toBe(true);
  });

  it("accepts uppercase and mixed case, which Postgres also stores", () => {
    expect(isUuid(VALID.toUpperCase())).toBe(true);
    expect(isUuid("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(true);
  });

  it("tolerates surrounding whitespace from a hand-typed query string", () => {
    expect(isUuid(`  ${VALID}  `)).toBe(true);
  });

  it("rejects the values that actually reach these parameters in practice", () => {
    // The reported crash: a category or status name pasted into a uuid filter.
    for (const bad of [
      "abc",
      "not-a-uuid",
      "1",
      "0",
      "",
      "   ",
      "3f2504e0-4f89-41d3-9a0c",           // truncated
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301-extra",
      "3f2504e0_4f89_41d3_9a0c_0305e82c3301", // wrong separators
      "../../etc/passwd",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301'",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301;drop table users",
      "9a0c0305e82c3301",                    // no separators at all
      "3f2504e0-4f89-41d3-9a0c-0305e82c330g", // 'g' is not hex
    ]) {
      expect(isUuid(bad), `should reject ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("rejects non-strings rather than coercing them", () => {
    // A route param is always a string, but these functions are also fed JSON
    // bodies. `String(1)` style coercion would turn a number or an object into
    // something that reaches the driver.
    for (const bad of [null, undefined, 1, 0, true, false, {}, [], [VALID]]) {
      expect(isUuid(bad), `should reject ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("does not accept a uuid with embedded whitespace", () => {
    expect(isUuid("3f2504e0 -4f89-41d3-9a0c-0305e82c3301")).toBe(false);
  });
});

describe("parseUuid", () => {
  it("returns the id lowercased, matching how Postgres stores uuid", () => {
    // A mixed-case id is valid; without normalisation the lookup silently misses
    // a row that does exist.
    expect(parseUuid("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(VALID);
  });

  it("trims before matching and normalising", () => {
    expect(parseUuid(`  ${VALID.toUpperCase()} `)).toBe(VALID);
  });

  it("returns null for a value that could never be a uuid", () => {
    expect(parseUuid("abc")).toBeNull();
    expect(parseUuid(null)).toBeNull();
    expect(parseUuid(undefined)).toBeNull();
    expect(parseUuid(42)).toBeNull();
  });

  it("accepts a well-formed id with no matching row", () => {
    // Guards the boundary: existence is the query's job. If this ever returns
    // null, the helper has grown a database dependency.
    expect(parseUuid(VALID)).not.toBeNull();
  });
});

describe("uuidFilter", () => {
  it("returns a normalised uuid for a valid filter value", () => {
    expect(uuidFilter(VALID.toUpperCase())).toBe(VALID);
  });

  it("collapses every unusable value to undefined, meaning 'do not constrain'", () => {
    // This is the behaviour that stops `?jurisdiction=abc` from reaching the
    // driver: the query degrades to an unfiltered list.
    for (const bad of ["abc", "", "  ", null, undefined, 7, {}]) {
      expect(uuidFilter(bad), `should be undefined for ${JSON.stringify(bad)}`).toBeUndefined();
    }
  });

  it("is distinct from null so callers can spread it into an eq() chain safely", () => {
    // `eq(col, undefined)` would throw; callers use a truthiness check, and
    // `undefined` is the value that skips the condition.
    expect(uuidFilter("nope")).not.toBeNull();
  });
});