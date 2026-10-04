import Link from "next/link";
import {
  getSearchInsightsSafely,
  TOP_QUERY_LIMIT,
  type SearchInsights,
} from "@/lib/admin/search-insights";

/**
 * Admin-only search intelligence.
 *
 * Reads the same aggregates `getSearchInsights()` returns and renders them as a
 * product panel, not a data dump. Three things it deliberately does NOT do:
 *
 *   1. No account identity. Not for a top query, not for a recent search. The
 *      underlying module does not select `user_id`, so there is nothing here to
 *      display even by accident.
 *   2. No invented quality signal. `search_usage` records no result count, so
 *      "zero-result searches" and "needs better relevance" cannot be computed.
 *      The panel states that as a known limitation instead of guessing — a
 *      plausible-looking but fabricated ranking would be worse than an absent
 *      one, because it would be acted on.
 *   3. No new query path. Every count comes from the bounded aggregates.
 */

function StatCard({
  value,
  label,
}: {
  value: number | string;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-sm text-neutral-500">{label}</div>
    </div>
  );
}

/** `YYYY-MM-DD` -> `12 Jun`, without pulling in a date library. */
function shortDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month}` : day;
}

function formatWhen(value: Date): string {
  return new Intl.DateTimeFormat("en-AE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dubai",
  }).format(value);
}

export async function SearchInsightsPanel() {
  const { insights, error } = await getSearchInsightsSafely();

  return (
    <section aria-labelledby="search-insights-heading">
      <h2
        id="search-insights-heading"
        className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mt-8 mb-3"
      >
        Search insights
      </h2>

      {error ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {error}
        </p>
      ) : !insights ? null : insights.totalSearches === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
          No searches have been recorded yet. Insights appear once signed-in
          accounts start searching.
        </p>
      ) : (
        <PanelBody insights={insights} />
      )}
    </section>
  );
}

function PanelBody({ insights }: { insights: SearchInsights }) {
  const peak = insights.dailyVolume.reduce((max, d) => Math.max(max, d.searches), 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={insights.totalSearches.toLocaleString()} label="Searches recorded" />
        <StatCard value={insights.last7Days.toLocaleString()} label="Searches · 7 days" />
        <StatCard value={insights.distinctQueries.toLocaleString()} label="Distinct queries" />
        <StatCard value={insights.searchers.toLocaleString()} label="Accounts that searched" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Most searched. Links straight into the product so an administrator
            can see what the person actually saw. */}
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-neutral-900">Most searched</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Top {Math.min(insights.topQueries.length, TOP_QUERY_LIMIT)} queries of{" "}
            {insights.totalSearches.toLocaleString()}. Case-insensitive.
          </p>
          {insights.topQueries.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-600">No queries recorded.</p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <caption className="sr-only">
                Most searched queries, with search counts and the number of
                distinct accounts that ran each one
              </caption>
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th scope="col" className="py-2 pr-3 font-medium">Query</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Searches</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Accounts</th>
                  <th scope="col" className="py-2 text-right font-medium">Last</th>
                </tr>
              </thead>
              <tbody>
                {insights.topQueries.map(row => (
                  <tr key={row.query} className="border-b border-neutral-100 last:border-0">
                    <td className="py-2 pr-3">
                      <Link
                        href={`/search?q=${encodeURIComponent(row.query)}`}
                        className="text-neutral-900 underline-offset-2 hover:underline"
                      >
                        {row.query}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-neutral-700">
                      {row.searches}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-neutral-500">
                      {row.searchers}
                    </td>
                    <td className="py-2 text-right text-xs whitespace-nowrap text-neutral-500">
                      {formatWhen(row.lastSearchedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent searches, with no account attached. */}
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-neutral-900">Recent searches</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Newest first, without account identity.
          </p>
          {insights.recentSearches.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-600">Nothing yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {insights.recentSearches.map((row, i) => (
                <li key={`${row.searchedAt.toISOString()}-${i}`} className="text-sm">
                  <Link
                    href={`/search?q=${encodeURIComponent(row.query)}`}
                    className="text-neutral-900 underline-offset-2 hover:underline"
                  >
                    {row.query}
                  </Link>
                  <span className="ml-2 text-xs text-neutral-500">
                    {formatWhen(row.searchedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Daily volume. Bars are proportional to the busiest day in the window. */}
      <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-neutral-900">
          Search volume · last {insights.trendDays} days
        </h3>
        {insights.dailyVolume.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-600">
            No searches in this window.
          </p>
        ) : (
          <ul className="mt-4 flex items-end gap-1" aria-label="Daily search volume">
            {insights.dailyVolume.map(d => (
              <li key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="text-[10px] tabular-nums text-neutral-500">
                  {d.searches}
                </span>
                <span
                  className="w-full rounded-t bg-neutral-300"
                  style={{ height: `${peak > 0 ? Math.max(4, (d.searches / peak) * 64) : 4}px` }}
                />
                <span className="text-[10px] whitespace-nowrap text-neutral-500">
                  {shortDay(d.day)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The honest gap. Written as prose rather than hidden, so nobody
          concludes the product simply lacks the feature. */}
      <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-600">
        <p className="font-medium text-neutral-700">
          Not measurable from current data
        </p>
        <p className="mt-1">
          Zero-result searches, low-result searches and searches whose relevance
          was weak are <strong>not</strong> shown, because{" "}
          <code>search_usage</code> records only the query text and timestamp —
          it does not store how many results that search returned. Counting a
          query as &ldquo;unsuccessful&rdquo; would mean guessing, so these figures
          are withheld until a result count is recorded per search.
        </p>
      </div>
    </>
  );
}
