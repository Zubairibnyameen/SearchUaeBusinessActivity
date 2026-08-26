import Link from "next/link";
import { eq } from "drizzle-orm";
import { searchUnified } from "@/lib/search/engine";
import { enrichResponse } from "@/lib/search/enrichment";
import { db } from "@/lib/db";
import { jurisdictions } from "@/lib/db/schema";
import { SearchResultCard } from "./search-results";
import type { UnifiedSearchResponse } from "@/lib/search/types";

interface SearchResultsProps {
  searchParams: Promise<{ q?: string; page?: string; jurisdiction?: string }>;
}

const PAGE_SIZE = 10;
const GROUP_LIMIT = 6;

function pageHref(
  q: string,
  page: number,
  jurisdiction?: string | null
): string {
  const params = new URLSearchParams({ q, page: String(page) });
  if (jurisdiction) params.set("jurisdiction", jurisdiction);
  return `/search?${params.toString()}`;
}

function AvailabilityStrip({ data }: { data: UnifiedSearchResponse }) {
  const matched = data.jurisdictionGroups.filter(g => g.status === "match");
  const unmatched = data.jurisdictionGroups.filter(g => g.status === "no_match");

  return (
    <div className="mb-8 rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-400">
        Jurisdiction availability
      </h2>
      <div className="flex flex-wrap gap-2">
        {matched.map(g => (
          <a
            key={g.jurisdiction.id}
            href={`#jur-${g.jurisdiction.slug}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Match found · {g.jurisdiction.name} ({g.totalMatches})
          </a>
        ))}
        {unmatched.map(g => (
          <span
            key={g.jurisdiction.id}
            title="Not found in this jurisdiction's currently indexed official activity list. This does not mean the activity is prohibited."
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-500"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" />
            No strong match found · {g.jurisdiction.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export async function SearchResults({ searchParams }: SearchResultsProps) {
  const params = await searchParams;
  const query = params.q?.trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

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

  const summaries = await enrichResponse(data);

  if (data.results.length === 0 && page === 1) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6 text-neutral-400" aria-hidden>
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

  const matchedCount = data.availability.matchedJurisdictionSlugs.length;
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const matchGroups = data.jurisdictionGroups.filter(g => g.status === "match");

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
        <span className="text-xs tabular-nums text-neutral-400">
          {data.meta.tookMs}ms
        </span>
      </div>

      <AvailabilityStrip data={data} />

      <div className="space-y-10">
        {matchGroups.map(group => (
          <section key={group.jurisdiction.id} id={`jur-${group.jurisdiction.slug}`}>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 pb-2">
              <div>
                <h3 className="text-base font-bold text-neutral-900">
                  <Link
                    href={`/jurisdictions/${group.jurisdiction.slug}`}
                    className="transition-colors hover:text-blue-700"
                  >
                    {group.jurisdiction.name}
                  </Link>
                </h3>
                <p className="text-xs text-neutral-500">
                  Free Zone / Mainland shown per result ·{" "}
                  {group.jurisdiction.emirate.replace(/_/g, " ")}
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                Match found
                {group.totalMatches > 0 &&
                  ` · ${group.totalMatches} ${group.totalMatches === 1 ? "activity" : "activities"}`}
                {group.topResults.length < group.totalMatches &&
                  ` (showing top ${group.topResults.length})`}
              </span>
            </div>
            <div className="space-y-4">
              {group.topResults.map(result => (
                <SearchResultCard
                  key={`${result.matchType}-${result.activity.id}`}
                  result={result}
                  summary={summaries.get(result.activity.id)}
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
        Try &quot;Digital Marketing Agency&quot;, &quot;Medical Clinic&quot; or
        &quot;General Trading&quot;.
      </p>
    </div>
  );
}
