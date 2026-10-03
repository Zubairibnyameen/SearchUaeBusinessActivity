/**
 * Presentational view for `/account/search-history`.
 *
 * WHY THIS IS SEPARATE FROM THE PAGE
 *   The page owns identity and the query; this file owns the three states a
 *   personal list can be in, and they are genuinely three different facts:
 *
 *     null                     -> the read failed. Say so. Never show a list.
 *     entries: []              -> a truthful "you have not searched yet".
 *     entries: [...]           -> the real rows, newest first.
 *
 *   Collapsing the first into the second would tell someone who has searched
 *   forty times that they have never searched, which is the same lie the
 *   `/account` usage card refuses to tell.
 *
 * NO IDENTIFIERS ARE RENDERED
 *   `SearchHistoryEntry` carries a row `id` purely so React has a stable key.
 *   It is passed to `key` and to nothing else, so it never becomes an attribute
 *   or a string in the output. There is no account id, provider id or email on
 *   this page, because the reader already knows whose history it is.
 */
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  History,
  RotateCcw,
  Search as SearchIcon,
} from "lucide-react";
import { formatProfileDateTime } from "@/components/profile/profile-card";
import type { SearchHistoryPage } from "@/lib/auth/search-usage";

const HISTORY_PATH = "/account/search-history";

/**
 * Rebuilds the history URL for a given page.
 *
 * Only `page` is ever carried, and `page=1` is omitted so the first page has a
 * clean URL. Nothing from the request is echoed back into a link.
 */
function pageHref(page: number): string {
  return page > 1 ? `${HISTORY_PATH}?page=${page}` : HISTORY_PATH;
}

/**
 * The "run this again" link, built with `URLSearchParams` rather than string
 * concatenation.
 *
 * The stored query is free text and may contain `&`, `#`, `?` or a quote, so a
 * hand-built `/search?q=${query}` would be truncated or, worse, allow the query
 * to inject extra parameters. Encoding is what keeps "Search again" a link to
 * the same single query, always.
 */
function searchAgainHref(query: string): string {
  const params = new URLSearchParams();
  params.set("q", query);
  return `/search?${params.toString()}`;
}

function HistoryRow({
  entry,
  canSearchAgain,
}: {
  entry: SearchHistoryPage["entries"][number];
  canSearchAgain: boolean;
}) {
  return (
    <li className="flex flex-col gap-3 border-b border-neutral-100 px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5">
      <div className="min-w-0">
        <p
          data-testid="history-query"
          className="break-words text-sm font-medium text-neutral-900"
        >
          {entry.query}
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {/* A machine-readable instant alongside the formatted one, so the
              value is unambiguous to anything parsing the page. */}
          <time dateTime={entry.createdAt.toISOString()}>
            {formatProfileDateTime(entry.createdAt, "Unknown time")}
          </time>
        </p>
      </div>

      {canSearchAgain ? (
        <Link
          href={searchAgainHref(entry.query)}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-900 sm:self-auto"
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Search again
        </Link>
      ) : null}
    </li>
  );
}

function EmptyState({ canSearch }: { canSearch: boolean }) {
  return (
    <div className="px-4 py-12 text-center sm:px-6">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-neutral-100">
        <History aria-hidden className="size-6 text-neutral-500" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-neutral-900">
        No searches recorded yet
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-600">
        {canSearch
          ? "Your searches appear here once you run one. This list is empty because nothing has been recorded for your account — not because anything is hidden."
          : "Nothing has been recorded for your account. Search is unavailable while your account is suspended, so no new searches are being added."}
      </p>
      {canSearch ? (
        <Link
          href="/search"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
        >
          <SearchIcon aria-hidden className="size-4" />
          Search activities
        </Link>
      ) : null}
    </div>
  );
}

function UnavailableState() {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">Your search history could not be loaded.</p>
        <p className="mt-1 leading-relaxed">
          Nothing has been estimated or filled in. Try again shortly — the counts
          on your <Link href="/account" className="underline underline-offset-2">account page</Link>{" "}
          will keep working in the meantime.
        </p>
      </div>
    </div>
  );
}

export function SearchHistoryView({
  history,
  page,
  pageSize,
  isActive,
}: {
  /** `null` when the read failed, which is not the same as "no history". */
  history: SearchHistoryPage | null;
  page: number;
  /** Rows per page, so "page X of Y" can be stated without guessing. */
  pageSize: number;
  isActive: boolean;
}) {
  const entries = history?.entries ?? [];
  const total = history?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min((page - 1) * pageSize + entries.length, total);

  return (
    <div className="bg-neutral-50">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/account"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-700"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Your account
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-neutral-900">
              Your search history
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              {history === null
                ? "History unavailable right now."
                : total === 0
                  ? "No searches recorded for your account."
                  : `${total.toLocaleString("en")} ${
                      total === 1 ? "search" : "searches"
                    } recorded, newest first.`}
            </p>
          </div>
        </div>

        {/* ── A suspended account keeps its history, but is told why new rows
               are not arriving. The read is not a capability that was
               withdrawn, so it is not disabled. ─────────────────────────── */}
        {!isActive ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
            This account is suspended, so new searches are not being recorded.
            The searches below were made while the account was active, and
            they remain yours to review.
          </p>
        ) : null}

        <section
          aria-labelledby="search-history-heading"
          className="mt-6 rounded-2xl border border-neutral-200 bg-white"
        >
          <h2 id="search-history-heading" className="sr-only">
            Recorded searches
          </h2>

          {history === null ? (
            <div className="p-4 sm:p-5">
              <UnavailableState />
            </div>
          ) : entries.length === 0 ? (
            <EmptyState canSearch={isActive} />
          ) : (
            <>
              <ul aria-label="Your recorded searches" className="divide-y divide-neutral-100">
                {entries.map(entry => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    canSearchAgain={isActive}
                  />
                ))}
              </ul>

              {/* ── Paging ────────────────────────────────────────────────
                  The limit is applied in the DAL, so this control never
                  loads more than one bounded page at a time. */}
              <nav
                aria-label="Search history pages"
                className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3 text-sm sm:px-5"
              >
                <p className="text-neutral-500">
                  Showing {firstRow.toLocaleString("en")}&ndash;
                  {lastRow.toLocaleString("en")} of{" "}
                  {total.toLocaleString("en")} · page {page.toLocaleString("en")}{" "}
                  of {totalPages.toLocaleString("en")}
                </p>
                <div className="flex items-center gap-2">
                  {page > 1 ? (
                    <Link
                      href={pageHref(page - 1)}
                      rel="prev"
                      className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                    >
                      <ChevronLeft aria-hidden className="size-4" />
                      Newer
                    </Link>
                  ) : null}
                  {history.hasMore ? (
                    <Link
                      href={pageHref(page + 1)}
                      rel="next"
                      className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                    >
                      Older
                      <ChevronRight aria-hidden className="size-4" />
                    </Link>
                  ) : null}
                </div>
              </nav>
            </>
          )}
        </section>

        <p className="mt-6 text-xs leading-relaxed text-neutral-500">
          This list is scoped to your own account and is built from searches you
          ran while signed in. It is not shared with other users, and deleting
          your account removes it. No authentication tokens, OAuth secrets or
          session credentials appear on this page.
        </p>
      </div>
    </div>
  );
}
