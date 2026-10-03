/**
 * The one place that decides whether a string could be a `uuid` column value.
 *
 * WHY THIS IS SHARED
 *   The same guard was copy-pasted into five page modules — the two admin
 *   detail routes, the admin research filter, the public activity route and its
 *   metadata builder. Copy-pasted guards drift, and here they had already
 *   drifted in behaviour: some normalised case, some did not.
 *
 * WHY IT IS NEEDED AT ALL
 *   Every one of those values reaches Postgres as
 *   `eq(table.id, <route param>)` against a `uuid` column. An unvalidated
 *   parameter does not come back as an empty result set, it comes back as
 *   `invalid input syntax for type uuid` — a 500, and in development a raw
 *   Postgres error rendered into the page. Validating the shape first turns that
 *   into an honest 404 or an ignored filter.
 *
 * SCOPE, DELIBERATELY
 *   This is a *syntax* check, not an existence check. It answers "could this
 *   ever be a uuid?", never "does this row exist?" — existence is the query's
 *   job. It reveals nothing about the database: the shape is public, and every
 *   real id is already visible in public URLs.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `raw` is a string that is syntactically a UUID. */
export function isUuid(raw: unknown): raw is string {
  return typeof raw === "string" && UUID_RE.test(raw.trim());
}

/**
 * Normalise a UUID to the lowercase form Postgres stores, or return null when
 * the input could never be one.
 *
 * Lowercasing matters: a mixed-case id is valid and would otherwise be compared
 * against a normalised column, so the lookup would miss a row that exists.
 */
export function parseUuid(raw: unknown): string | null {
  if (!isUuid(raw)) return null;
  return (raw as string).trim().toLowerCase();
}

/**
 * Guard a value destined for a `uuid` comparison in a query filter, where the
 * "no filter" signal is `undefined` rather than `null`.
 *
 * `""`, `null` and `"abc"` all collapse to `undefined`, which the callers
 * already treat as "do not constrain this query" — so a bad query-string value
 * degrades to an unfiltered list instead of erroring.
 */
export function uuidFilter(raw: unknown): string | undefined {
  return parseUuid(raw) ?? undefined;
}