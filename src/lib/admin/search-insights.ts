/**
 * Search analytics for the admin panel — data access.
 *
 * WHY THIS EXISTS
 *   Product needs to know what people actually search for: which activities are
 *   in demand, which phrasings miss, and where coverage is thin. `search_usage`
 *   already records every authenticated search, so the raw material is there and
 *   this module only aggregates it.
 *
 * PRIVACY BOUNDARY — READ THIS BEFORE ADDING A COLUMN
 *   The purpose is search improvement, NOT surveillance of individuals. This
 *   module therefore returns AGGREGATES ONLY:
 *
 *     - `user_id` is never selected into any returned object. Not in the
 *       top-query rows, not in the recent rows, not in the daily buckets.
 *     - There is no "searches by user" query here, and one must not be added
 *       without a deliberate decision. `/account/search-history` is scoped to
 *       the caller and stays that way.
 *     - `searchers` is a `COUNT(DISTINCT user_id)` - a number with no identity
 *       attached. It answers "is this one person's typo or a real gap in
 *       coverage?", which is the product question, and nothing more.
 *     - No email, display name, auth user id, provider id, IP or user agent is
 *       read. Those columns are not even present on `search_usage`.
 *
 *   Retention: `search_usage` carries a documented, deliberately-pending
 *   retention policy (see the schema). Aggregates do not change that, and this
 *   module adds no new persistence.
 *
 * WHAT CANNOT BE COMPUTED FROM THE CURRENT SCHEMA
 *   `search_usage` has no result-count column, so every "this search went badly"
 *   question is currently unanswerable:
 *
 *     - zero-result searches          -> needs a stored result count
 *     - low-result searches           -> needs a stored result count
 *     - searches with weak relevance  -> needs a stored score, not just a count
 *
 *   Rather than infer those from anything (they cannot be derived reliably after
 *   the fact), the panel reports them as unavailable. See the
 *   `resultCountAvailable` flag on `SearchInsights`.
 *
 * The caller must have run `requireAdmin()` already; like `review-queue.ts` and
 * `admin-users.ts`, this module re-derives nothing.
 */
import "server-only";

import { and, desc, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { searchUsage } from "@/lib/db/schema";

/** Hard ceilings. Every read below is bounded; nothing here can scan the table. */
export const TOP_QUERY_LIMIT = 25;
export const RECENT_SEARCH_LIMIT = 20;
export const TREND_DAYS = 14;

/** Longest query string rendered in the panel. Free text can be arbitrarily long. */
const MAX_QUERY_DISPLAY = 120;

export interface TopQuery {
  /** Normalised for grouping: lower-cased and trimmed. */
  query: string;
  searches: number;
  /** Distinct accounts that ran it. A count, never an identity. */
  searchers: number;
  lastSearchedAt: Date;
}

export interface RecentSearch {
  query: string;
  searchedAt: Date;
}

export interface DailySearchVolume {
  /** `YYYY-MM-DD` in UTC. */
  day: string;
  searches: number;
}

export interface SearchInsights {
  totalSearches: number;
  distinctQueries: number;
  searchers: number;
  last7Days: number;
  last30Days: number;
  topQueries: TopQuery[];
  recentSearches: RecentSearch[];
  dailyVolume: DailySearchVolume[];
  /**
   * Always `false` until `search_usage` records a result count.
   *
   * Exposed so the UI can state the limitation as fact rather than the panel
   * silently omitting a section the reader assumes does not exist.
   */
  resultCountAvailable: false;
  /**
   * Number of days covered by `dailyVolume`. Lets the UI render a truthful
   * caption when the table has been quiet for a while.
   */
  trendDays: number;
}

/** Lower-cased, trimmed, whitespace-collapsed form used for grouping. */
const NORMALISED_QUERY = sql<string>`lower(trim(${searchUsage.query}))`;

function clip(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_QUERY_DISPLAY
    ? `${collapsed.slice(0, MAX_QUERY_DISPLAY - 1)}…`
    : collapsed;
}

/**
 * Aggregated search intelligence.
 *
 * The four reads run concurrently in one round trip. A failure in any of them
 * propagates to `getSearchInsightsSafely`, which reports it as an unavailable
 * panel rather than as zeroes — "we could not read this" and "nobody searched
 * for anything" are different claims and must not look alike.
 */
export async function getSearchInsights(): Promise<{
  insights: SearchInsights | null;
  error: string | null;
}> {
  const [overview, topQueries, recentSearches, dailyVolume] =
    await Promise.all([
      db
        .select({
          totalSearches: sql<number>`count(*)::int`,
          distinctQueries: sql<number>`count(distinct ${NORMALISED_QUERY})::int`,
          searchers: sql<number>`count(distinct ${searchUsage.userId})::int`,
          last7Days: sql<number>`(count(*) filter (where ${searchUsage.createdAt} > now() - interval '7 days'))::int`,
          last30Days: sql<number>`(count(*) filter (where ${searchUsage.createdAt} > now() - interval '30 days'))::int`,
        })
        .from(searchUsage),

      db
        .select({
          query: NORMALISED_QUERY,
          searches: sql<number>`count(*)::int`,
          searchers: sql<number>`count(distinct ${searchUsage.userId})::int`,
          lastSearchedAt: sql<Date>`max(${searchUsage.createdAt})`,
        })
        .from(searchUsage)
        .groupBy(NORMALISED_QUERY)
        // Deterministic tie-break so equal-frequency queries do not reorder
        // between renders (and between two admins looking at the same page).
        .orderBy(desc(sql`count(*)`), NORMALISED_QUERY)
        .limit(TOP_QUERY_LIMIT),

      // No `user_id` in the projection: a recent-search list keyed to an account
      // would be a per-user log with extra steps.
      db
        .select({
          query: searchUsage.query,
          searchedAt: searchUsage.createdAt,
        })
        .from(searchUsage)
        .orderBy(desc(searchUsage.createdAt))
        .limit(RECENT_SEARCH_LIMIT),

      db
        .select({
          day: sql<string>`to_char(${searchUsage.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
          searches: sql<number>`count(*)::int`,
        })
        .from(searchUsage)
        .where(
          and(
            gte(
              searchUsage.createdAt,
              sql<Date>`now() - make_interval(days => ${TREND_DAYS})`
            )
          )
        )
        .groupBy(
          sql`to_char(${searchUsage.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`
        )
        .orderBy(
          sql`to_char(${searchUsage.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`
        ),
    ]);

  const row = overview[0];

  // `groupBy` on an empty table yields no rows; an empty top-query list is a
  // truthful "nobody has searched yet", not an error.
  return {
    insights: {
      totalSearches: row?.totalSearches ?? 0,
      distinctQueries: row?.distinctQueries ?? 0,
      searchers: row?.searchers ?? 0,
      last7Days: row?.last7Days ?? 0,
      last30Days: row?.last30Days ?? 0,
      topQueries: topQueries
        .filter(t => typeof t.query === "string" && t.query.length > 0)
        .map(t => ({
          query: clip(t.query),
          searches: t.searches,
          searchers: t.searchers,
          lastSearchedAt: t.lastSearchedAt,
        })),
      recentSearches: recentSearches.map(r => ({
        query: clip(r.query),
        searchedAt: r.searchedAt,
      })),
      dailyVolume: dailyVolume.map(d => ({
        day: d.day,
        searches: d.searches,
      })),
      resultCountAvailable: false,
      trendDays: TREND_DAYS,
    },
    error: null,
  };
}

/**
 * Dashboard-safe wrapper.
 *
 * `search_usage` may not exist on a deployment that has not run the
 * `0011_search_usage.sql` migration, and a dashboard that 500s because an
 * optional panel is unavailable is worse than one that says so.
 */
export async function getSearchInsightsSafely(): Promise<{
  insights: SearchInsights | null;
  error: string | null;
}> {
  try {
    return await getSearchInsights();
  } catch (error) {
    console.error("[admin] search insights could not be read:", error);
    return { insights: null, error: "Search insights are unavailable." };
  }
}
