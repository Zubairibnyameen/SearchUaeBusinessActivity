/**
 * Per-user search usage — server-only module.
 *
 * TWO FUNCTIONS, TWO DIFFERENT CONTRACTS
 *   `recordSearchUsage`       writes one row and THROWS on database failure.
 *                             Used where the caller wants to know.
 *   `recordSearchUsageSafely` never throws. This is what the search request
 *                             paths use, because a bookkeeping failure must
 *                             not turn a working search into a 500.
 *
 * WHY THE FUNCTIONS TAKE A `Viewer` AND NOT AN ID
 *   Taking the resolved `Viewer` makes "the user is whoever the verified
 *   session says they are" a type-level property rather than a convention. There
 *   is no parameter a route handler, search param or form field can be threaded
 *   into that would attribute a search to somebody else, so the classic
 *   "trust the client-supplied userId" bug has no code path to live in.
 *
 * WHAT IS WRITTEN
 *   `{ userId, query }` — and that is the entire insert. The object is built
 *   from a literal, not spread from the viewer, so `authUserId`,
 *   `providerUserId`, `email`, `provider`, the role and the status are not
 *   merely unused: they are not parameterised at all. See migration 0011 for why
 *   those columns do not exist.
 *
 * RETENTION — INTENTIONALLY PENDING
 *   Rows are never deleted automatically. A search query is free text and may
 *   contain personal data (a person's name, a company, a licence number), so a
 *   retention policy — how long the raw query is kept, whether old rows are
 *   deleted or anonymised — has to be decided before real data accumulates.
 *   The one guarantee already enforced is structural rather than scheduled:
 *   `search_usage.user_id` cascades on `app_users` deletion, so removing an
 *   account removes its history in the same transaction.
 */
import "server-only";

import { and, count, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { searchUsage } from "@/lib/db/schema";
import type { Viewer } from "./viewer";

/**
 * Matches `MAX_QUERY_LENGTH` in the search route. Anything the recorder can be
 * handed has already passed that cap, so this slice is a second line of defence
 * rather than the primary one — and it guarantees the table's CHECK constraint
 * is never the thing that fails an insert.
 */
export const MAX_STORED_QUERY_LENGTH = 2000;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** What the dashboard needs to draw a person's own usage, and nothing more. */
export interface SearchUsageCounts {
  /** Lifetime searches recorded for this account. */
  total: number;
  /** Searches recorded in the trailing 30 days. */
  last30Days: number;
}

function normalizeQuery(query: string): string {
  return query.trim().slice(0, MAX_STORED_QUERY_LENGTH);
}

/**
 * Record one search against the caller's own account.
 *
 * Takes the resolved `Viewer` — never a bare id — so the row can only ever
 * belong to the authenticated caller. Throws if the insert fails; use
 * `recordSearchUsageSafely` on a request path.
 *
 * The active check is repeated here even though the safe wrapper already
 * performs it. This function is exported, so the "only an active account
 * accumulates history" rule is enforced at the module that owns the write
 * rather than depending on every current and future caller to remember it.
 */
export async function recordSearchUsage(
  viewer: Viewer,
  query: string
): Promise<void> {
  if (!viewer.isActive) return;

  const stored = normalizeQuery(query);
  if (!stored) return;

  await db.insert(searchUsage).values({
    // The only two columns this module can write. `viewer.id` is our own
    // surrogate key from the verified session.
    userId: viewer.id,
    query: stored,
  });
}

/**
 * Fire-and-forget variant for search request paths.
 *
 * Contract, in order of importance:
 *   1. It NEVER throws. A search that worked must not be reported as a failure
 *      because a usage row could not be written.
 *   2. It records only for an authenticated, ACTIVE account. A suspended
 *      account has lost product access, so its searches must not accumulate
 *      new history — and a null viewer (anonymous) never records at all. The
 *      same two checks also live in `recordSearchUsage`, so the guarantee
 *      survives a future caller picking the throwing variant instead.
 *   3. It logs the failure server-side, and logs the error only: the query text
 *      is personal data and is deliberately not written to the log.
 */
export async function recordSearchUsageSafely(
  viewer: Viewer | null,
  query: string
): Promise<void> {
  // Anonymous callers are a normal, expected case, not an error worth logging.
  if (!viewer) return;
  if (!viewer.isActive) return;
  if (!normalizeQuery(query)) return;

  try {
    await recordSearchUsage(viewer, query);
  } catch (error) {
    // Never includes the query, the session, or any credential. The user's
    // search has already succeeded by this point; this is bookkeeping.
    console.error(
      "[search-usage] failed to record search usage:",
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * The caller's OWN usage counts, for the account dashboard.
 *
 * Scoped to `viewer.id` inside the query. Because the only entry point takes a
 * `Viewer` resolved from the session, there is no way to ask this function for
 * another person's numbers, and no such function exists for anyone to call.
 *
 * `now` is injectable so the 30-day boundary is testable. It is inclusive of the
 * boundary instant: a search exactly 30 days old is counted.
 */
export async function getSearchUsageCounts(
  viewer: Viewer,
  now: number = Date.now()
): Promise<SearchUsageCounts> {
  const thirtyDaysAgo = new Date(now - THIRTY_DAYS_MS);

  const [total, recent] = await Promise.all([
    db
      .select({ n: count() })
      .from(searchUsage)
      .where(eq(searchUsage.userId, viewer.id)),
    db
      .select({ n: count() })
      .from(searchUsage)
      .where(
        and(
          eq(searchUsage.userId, viewer.id),
          gte(searchUsage.createdAt, thirtyDaysAgo)
        )
      ),
  ]);

  return { total: total[0]?.n ?? 0, last30Days: recent[0]?.n ?? 0 };
}

/**
 * Dashboard counts, or `null` when they could not be read.
 *
 * The distinction matters: `null` means "unknown" and the dashboard must show
 * an unavailable state, whereas a real `0` means "this account has no recorded
 * searches" and is shown as a truthful empty state. Collapsing the two would
 * either hide a broken query or claim knowledge the app does not have.
 */
export async function getSearchUsageCountsSafely(
  viewer: Viewer
): Promise<SearchUsageCounts | null> {
  try {
    return await getSearchUsageCounts(viewer);
  } catch (error) {
    console.error(
      "[search-usage] failed to read search usage counts:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Search history
// ─────────────────────────────────────────────────────────────────────────────

/** Rows shown per page of history. Small on purpose: this is a list, not a table. */
export const SEARCH_HISTORY_PAGE_SIZE = 20;

/**
 * Hard ceiling on `limit`, independent of the page size.
 *
 * A caller-supplied limit is clamped rather than trusted, so no future caller —
 * and no crafted `?limit=` on a route that forwards one — can ask the database
 * for an unbounded result set. The account page is a dashboard, not a data dump.
 */
export const SEARCH_HISTORY_MAX_LIMIT = 50;

/** One past search, as shown to its owner. Deliberately not a `SearchUsage` row. */
export interface SearchHistoryEntry {
  /**
   * The `search_usage` row id. Present so React has a stable key; it is used as
   * a `key` only and is never rendered, so no internal id reaches the markup.
   */
  id: string;
  query: string;
  createdAt: Date;
}

export interface SearchHistoryPage {
  entries: SearchHistoryEntry[];
  /** Lifetime count for this account, for "showing X of Y" and the page count. */
  total: number;
  /** Whether a further page exists. */
  hasMore: boolean;
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return SEARCH_HISTORY_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), SEARCH_HISTORY_MAX_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) return 0;
  return Math.trunc(offset);
}

/**
 * The caller's OWN search history, newest first, one bounded page at a time.
 *
 * SCOPE
 *   Takes a `Viewer`, never an id, so the row filter is decided by the verified
 *   session inside the query. There is no parameter a route handler or query
 *   string can supply to widen this to somebody else's history, and no variant
 *   of this function exists that takes one. This is the read-side twin of the
 *   same rule `recordSearchUsage` enforces on the write side.
 *
 * SUSPENDED ACCOUNTS MAY READ
 *   Unlike the write path, there is deliberately NO `viewer.isActive` check
 *   here. Suspension withdraws the ability to run new searches; it does not
 *   confiscate the record of searches that already happened, and it does not
 *   erase rows. `/account` already shows a suspended person their own totals,
 *   and this page is the detail behind those numbers. Deleting an account still
 *   removes its history in the same transaction, via the `ON DELETE CASCADE`.
 *
 * WHAT IS SELECTED
 *   An explicit column list of `id`, `query` and `createdAt`. `user_id` is used
 *   to filter but is not selected, so it is not in the returned objects and
 *   cannot be passed to a component even by accident.
 *
 * ORDERING
 *   `created_at DESC`, tie-broken by `id DESC`. The tie-break is not cosmetic:
 *   without it, two searches recorded in the same transaction can come back in
 *   either order, and a row that appears on two different pages while paging
 *   through the history is a real bug, not a cosmetic one.
 */
export async function listSearchHistory(
  viewer: Viewer,
  options: { limit?: number; offset?: number } = {}
): Promise<SearchHistoryPage> {
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: searchUsage.id,
        query: searchUsage.query,
        createdAt: searchUsage.createdAt,
      })
      .from(searchUsage)
      .where(eq(searchUsage.userId, viewer.id))
      .orderBy(desc(searchUsage.createdAt), desc(searchUsage.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ n: count() })
      .from(searchUsage)
      .where(eq(searchUsage.userId, viewer.id)),
  ]);

  const total = totals[0]?.n ?? 0;

  return {
    entries: rows.map(row => ({
      id: row.id,
      query: row.query,
      createdAt: row.createdAt,
    })),
    total,
    // A short page is the last page. Checking the length rather than just
    // `offset + rows.length < total` avoids claiming a next page exists when the
    // caller paged past the end and got nothing back.
    hasMore: rows.length === limit && offset + rows.length < total,
  };
}

/**
 * `listSearchHistory`, or `null` when the read failed.
 *
 * The dashboard's own rule, applied to the list: a failed read is "we do not
 * know", which is a different fact from "you have not searched yet". Returning
 * `null` lets the page say the former; collapsing it to an empty array would
 * invent a history the user may well have.
 */
export async function listSearchHistorySafely(
  viewer: Viewer,
  options: { limit?: number; offset?: number } = {}
): Promise<SearchHistoryPage | null> {
  try {
    return await listSearchHistory(viewer, options);
  } catch (error) {
    console.error(
      "[search-usage] failed to read search history:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
