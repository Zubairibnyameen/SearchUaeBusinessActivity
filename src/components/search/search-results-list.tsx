import Link from "next/link";
import { eq } from "drizzle-orm";
import { searchUnified } from "@/lib/search/engine";
import { enrichResponse } from "@/lib/search/enrichment";
import { db } from "@/lib/db";
import { jurisdictions } from "@/lib/db/schema";
import { SearchResultCard } from "./search-results";
import { SearchSignInWall } from "./search-sign-in-wall";
import { getViewer } from "@/lib/auth/viewer";
import { recordSearchUsageSafely } from "@/lib/auth/search-usage";
import { AccountSuspendedNotice } from "@/components/auth/account-suspended-notice";
import { MatchTypeBadge } from "@/components/ui/verification-badges";
import { SearchCompareBar } from "@/components/compare/search-compare-bar";
import type { UnifiedSearchResponse } from "@/lib/search/types";

interface SearchResultsProps {
  searchParams: Promise<{ q?: string; page?: string; jurisdiction?: string }>;
}

const PAGE_SIZE = 10;
// The engine caps each jurisdiction group at `groupLimit`. A group can never
// hold more than the page it came from, so capping at the page size means the
// grouped view renders the page in full — no item can sit in `results` while
// being hidden from the sections below.
const GROUP_LIMIT = PAGE_SIZE;

function pageHref(
  q: string,
  page: number,
  jurisdiction?: string | null
): string {
  const params = new URLSearchParams({ q, page: String(page) });
  if (jurisdiction) params.set("jurisdiction", jurisdiction);
  return `/search?${params.toString()}`;
}

/**
 * Rebuild the current search URL so the sign-in round trip can return the user
 * to exactly where they were. Every value is taken from the already-validated
 * `searchParams` object, never from free-form input.
 */
function buildSearchHref(params: {
  q?: string;
  page?: string;
  jurisdiction?: string;
}): string {
  const search = new URLSearchParams();
  const q = params.q?.trim();
  if (q) search.set("q", q);
  const page = Number.parseInt(params.page ?? "1", 10);
  if (Number.isFinite(page) && page > 1) search.set("page", String(page));
  if (params.jurisdiction && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(params.jurisdiction)) {
    search.set("jurisdiction", params.jurisdiction);
  }
  const qs = search.toString();
  return qs ? `/search?${qs}` : "/search";
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CrossIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * Availability summary — a clear, evidence-only statement of which indexed
 * jurisdictions match the query and which do not. Presence/absence claims are
 * always scoped to "currently indexed official data".
 */
function AvailabilityStrip({ data }: { data: UnifiedSearchResponse }) {
  const matched = data.jurisdictionGroups.filter(g => g.status === "match");
  const unmatched = data.jurisdictionGroups.filter(g => g.status === "no_match");
  const total = matched.length + unmatched.length;

  if (total === 0) return null;

  return (
    <div className="mb-8 grid overflow-hidden rounded-xl border border-neutral-200 bg-white md:grid-cols-2">
      <section className="p-5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-emerald-700">
          <CheckIcon className="h-4 w-4" />
          Found in {matched.length} of {total} indexed{" "}
          {total === 1 ? "jurisdiction" : "jurisdictions"}
        </h2>
        {matched.length > 0 ? (
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {matched.map(g => (
              <li key={g.jurisdiction.id} className="flex min-w-0 items-baseline justify-between gap-2">
                <a
                  href={`#jur-${g.jurisdiction.slug}`}
                  className="truncate text-sm font-medium text-neutral-800 transition-colors hover:text-blue-700 hover:underline"
                >
                  {g.jurisdiction.name}
                </a>
                <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                  {g.totalMatches} {g.totalMatches === 1 ? "match" : "matches"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">No matches in indexed data.</p>
        )}
      </section>

      {unmatched.length > 0 && (
        <section className="border-t border-neutral-200 p-5 md:border-l md:border-t-0">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            <CrossIcon className="h-4 w-4" />
            Not found in
          </h2>
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {unmatched.map(g => (
              <li
                key={g.jurisdiction.id}
                className="flex items-center gap-2 text-sm text-neutral-500"
                title="Not found in this jurisdiction's currently indexed official activity list. This does not mean the activity is prohibited."
              >
                <CrossIcon className="h-3.5 w-3.5 shrink-0 text-neutral-300" />
                <span className="truncate">{g.jurisdiction.name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-neutral-500">
            &quot;Not found&quot; applies to the official activity lists indexed
            so far — it does not mean the activity is prohibited or unavailable.
          </p>
        </section>
      )}
    </div>
  );
}

export async function SearchResults({ searchParams }: SearchResultsProps) {
  const params = await searchParams;
  const query = params.q?.trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  // ── Authorization gate ──
  // Resolved from the verified server-side session. The check sits here, in
  // the component that owns the `searchUnified` call, so the engine is never
  // reached without a session even if a new caller is added to this page.
  const viewer = await getViewer();
  if (viewer && !viewer.isActive) {
    // Signed in, but suspended. Say so plainly — a sign-in prompt would be a
    // dead end because re-authenticating does not lift a suspension.
    return <AccountSuspendedNotice />;
  }
  if (!viewer) {
    return (
      <SearchSignInWall
        nextPath={buildSearchHref(params)}
        query={query}
      />
    );
  }

  if (!query) {
    return <EmptyState />;
  }

  // Optional jurisdiction scope (slug)
  let jurisdictionId: string | undefined;
  let scopedName: string | null = null;
  const slug = params.jurisdiction?.trim();
  if (slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    const rows = await db
      .select({ id: jurisdictions.id, name: jurisdictions.name })
      .from(jurisdictions)
      .where(eq(jurisdictions.slug, slug))
      .limit(1);
    if (rows[0]) {
      jurisdictionId = rows[0].id;
      scopedName = rows[0].name;
    }
  }

  let data: UnifiedSearchResponse;
  try {
    data = await searchUnified({
      q: query,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      groupLimit: GROUP_LIMIT,
      ...(jurisdictionId ? { jurisdictionId } : {}),
    });
  } catch {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <h2 className="text-base font-semibold text-red-900">
          Something went wrong running your search.
        </h2>
        <p className="mt-1 text-sm text-red-700">Please try again.</p>
      </div>
    );
  }

  // Usage bookkeeping, once the engine has answered and before any rendering.
  // The viewer was resolved from the verified session above and is the only
  // accepted source of the account id, and `recordSearchUsageSafely` cannot
  // throw — so a failure here cannot turn a working search into an error page,
  // and cannot alter the results, ranking or markup below.
  await recordSearchUsageSafely(viewer, query);

  const summaries = await enrichResponse(data);

  if (data.results.length === 0 && page === 1) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6 text-neutral-500" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-neutral-900">
          No match found in currently indexed jurisdictions
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-neutral-600">
          &quot;{query}&quot; was not found in the official activity datasets
          indexed so far (DMCC, Ajman Free Zone, SPC Free Zone, RAKEZ, IFZA).
          This does <strong>not</strong> mean the activity is prohibited or
          unavailable in the UAE &mdash; it means it is not present in the data
          indexed to date.
        </p>
        <div className="mx-auto mt-6 max-w-md rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-left">
          <p className="text-sm text-neutral-600">
            Suggestions: try broader wording (e.g. &quot;trading&quot; instead of a brand name), check spelling, or verify directly with the relevant authority.
          </p>
        </div>
      </div>
    );
  }

  // The query matched, but this page is past the last one — a stale or
  // hand-edited `?page=`. Say so instead of rendering an empty result list that
  // looks like "nothing matched".
  if (data.results.length === 0) {
    const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
        <h2 className="text-lg font-semibold text-neutral-900">
          Nothing on page {page}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-neutral-600">
          {data.total.toLocaleString()}{" "}
          {data.total === 1 ? "activity matches" : "activities match"}{" "}
          &quot;{query}&quot;, which {data.total === 1 ? "is" : "are"} spread over{" "}
          {lastPage} {lastPage === 1 ? "page" : "pages"}. This page is past the
          last one.
        </p>
        <Link
          href={pageHref(query, 1, slug)}
          className="mt-6 inline-block rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          Go to page 1
        </Link>
      </div>
    );
  }

  const matchedCount = data.availability.matchedJurisdictionSlugs.length;
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  // Availability is a property of the query, not of the page, so the strip and
  // the compare bar keep using every matched jurisdiction. Only the result
  // sections below are page-scoped, so groups whose matches all rank on other
  // pages are skipped rather than rendered as empty headings.
  const matchGroups = data.jurisdictionGroups.filter(g => g.status === "match");
  // `topResults` is the requested page, partitioned by jurisdiction. The
  // intersection below is a no-op against the current engine and is kept as a
  // guard at the render boundary: if a group ever reached outside the requested
  // window again, the page would silently show results that were never paged
  // through — the failure this page is built to avoid.
  const pageIds = new Set(data.results.map(item => item.activity.id));
  const pageGroups = matchGroups
    .map(group => ({
      ...group,
      topResults: group.topResults.filter(item => pageIds.has(item.activity.id)),
    }))
    .filter(group => group.topResults.length > 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-neutral-600">
          <span className="font-semibold text-neutral-900">{data.total.toLocaleString()}</span>{" "}
          {data.total === 1 ? "activity" : "activities"}
          {scopedName ? (
            <>
              {" "}in{" "}
              <Link
                href={`/jurisdictions/${slug}`}
                className="font-semibold text-neutral-900 hover:underline"
              >
                {scopedName}
              </Link>
            </>
          ) : (
            <>
              {" "}across{" "}
              <span className="font-semibold text-neutral-900">{matchedCount}</span>{" "}
              {matchedCount === 1 ? "jurisdiction" : "jurisdictions"}
            </>
          )}{" "}
          for <span className="font-semibold">&quot;{query}&quot;</span>
        </h2>
        {scopedName ? null : (
          <span className="flex items-center gap-3 text-xs tabular-nums text-neutral-500">
            {totalPages > 1 && (
              <span>
                Page {page} of {totalPages}
              </span>
            )}
            <span>{data.meta.tookMs}ms</span>
          </span>
        )}
      </div>

      <AvailabilityStrip data={data} />

      {!scopedName && matchGroups.length > 0 && (
        <div className="mb-6">
          <SearchCompareBar
            query={query}
            matchedJurisdictions={matchGroups.map(g => ({
              slug: g.jurisdiction.slug,
              name: g.jurisdiction.name,
            }))}
          />
        </div>
      )}

      <div className="space-y-10">
        {pageGroups.map(group => (
          <section key={group.jurisdiction.id} id={`jur-${group.jurisdiction.slug}`}>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-neutral-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-neutral-900">
                  <Link
                    href={`/jurisdictions/${group.jurisdiction.slug}`}
                    className="transition-colors hover:text-blue-700"
                  >
                    {group.jurisdiction.name}
                  </Link>
                </h3>
                <p className="text-xs capitalize text-neutral-500">
                  {group.jurisdiction.emirate.replace(/_/g, " ")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {group.bestMatchType && (
                  <MatchTypeBadge matchType={group.bestMatchType} />
                )}
                <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                  {group.totalMatches} {group.totalMatches === 1 ? "match" : "matches"}
                  {group.topResults.length < group.totalMatches &&
                    ` · ${group.topResults.length} on this page`}
                </span>
                {/* "See all" only when this page is holding back matches for
                    this jurisdiction. The count is the engine's page-independent
                    `totalMatches`, not a re-count of what is rendered, so the
                    number can never disagree with the badge above it.
                    `pageHref` carries the original query through and scopes to
                    this jurisdiction, so the reader does not have to retype
                    anything. Page 1 is deliberate: the filtered view restarts
                    its own pagination from the top. */}
                {group.topResults.length < group.totalMatches ? (
                  <Link
                    href={pageHref(query, 1, group.jurisdiction.slug)}
                    className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
                  >
                    See all {group.totalMatches}
                    <span className="sr-only">
                      {` matching ${group.totalMatches === 1 ? "activity" : "activities"} in ${group.jurisdiction.name}`}
                    </span>
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="space-y-4">
              {group.topResults.map((r, i) => (
                <SearchResultCard
                  key={`${r.matchType}-${r.activity.id}`}
                  result={r}
                  summary={summaries.get(r.activity.id)}
                  index={i}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {totalPages > 1 && (
        <nav
          aria-label="Search result pages"
          className="mt-10 flex items-center justify-center gap-2"
        >
          {page > 1 ? (
            <Link
              href={pageHref(query, page - 1, slug)}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              &larr; Previous
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-100 bg-white px-3 py-1.5 text-sm text-neutral-300">
              &larr; Previous
            </span>
          )}
          <span className="px-2 text-sm tabular-nums text-neutral-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={pageHref(query, page + 1, slug)}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              Next &rarr;
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-100 bg-white px-3 py-1.5 text-sm text-neutral-300">
              Next &rarr;
            </span>
          )}
        </nav>
      )}

      <div className="mt-10 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-xs leading-relaxed text-neutral-500">
          Approval signals reflect what each authority&apos;s official source
          indicates and are not verified regulatory approvals. Government fees
          are shown only where verified from an authoritative source; absent
          fees are marked as not verified rather than zero. Always verify
          requirements with the official authority before applying.
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-16 text-center">
      <h2 className="text-lg font-semibold text-neutral-900">
        Enter a business idea to search
      </h2>
      <p className="mt-2 text-sm text-neutral-500">
        Try &quot;Real estate brokerage&quot;, &quot;Medical clinic&quot;,
        &quot;Restaurant&quot; or &quot;Software development&quot;.
      </p>
    </div>
  );
}