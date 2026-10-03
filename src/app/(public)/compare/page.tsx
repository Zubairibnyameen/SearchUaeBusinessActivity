import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, jurisdictions } from "@/lib/db/schema";
import { searchUnified } from "@/lib/search/engine";
import { getRegulatorySummaries, type RegulatorySummary } from "@/lib/search/enrichment";
import {
  VerifiedBadge,
  ApprovalSignalBadgeSmall,
  ResearchRequiredBadge,
  MatchTypeBadge,
} from "@/components/ui/verification-badges";
import { formatAed, formatEmirate, formatJurisdictionType, titleCaseEnum } from "@/lib/format";
import { JurisdictionSelector } from "@/components/compare/jurisdiction-selector";
import { SearchSignInWall } from "@/components/search/search-sign-in-wall";
import { getViewer } from "@/lib/auth/viewer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compare Jurisdictions",
  description:
    "Compare selected UAE free zones and mainland authorities side by side: activity availability, licence type, approval status, verified government fees and sources.",
  alternates: { canonical: "/compare" },
};

// Comparison is designed around 2–4 selected jurisdictions.
const MIN_JURISDICTIONS = 2;
const MAX_JURISDICTIONS = 4;

export default function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; jurisdictions?: string }>;
}) {
  return (
    <div className="bg-neutral-50">
      <div className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <header className="mx-auto max-w-2xl text-center">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
              Compare Jurisdictions
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              Enter a business activity to see how each indexed UAE authority
              treats it &mdash; availability, licence type, approval status,
              verified fees and sources, side by side.
            </p>
          </header>
          <form action="/compare" method="GET" role="search" className="mx-auto mt-6 flex max-w-2xl items-center gap-2">
            <label htmlFor="compare-q" className="sr-only">
              Activity to compare across jurisdictions
            </label>
            <input
              id="compare-q"
              type="text"
              name="q"
              placeholder="e.g. Medical Clinic"
              required
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm placeholder:text-neutral-500 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
            >
              Compare
            </button>
          </form>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {["Medical Clinic", "Digital Marketing", "General Trading", "Restaurant"].map(ex => (
              <Link
                key={ex}
                href={`/compare?q=${encodeURIComponent(ex)}`}
                className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600 shadow-sm transition-colors hover:border-neutral-300 hover:text-neutral-900"
              >
                {ex}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <Suspense fallback={<CompareSkeleton />}>
          <ComparisonResults searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

interface ComparisonColumn {
  slug: string;
  name: string;
  emirate: string;
  type: string;
  available: boolean;
  activityId?: string;
  officialName?: string;
  isicCode?: string | null;
  licenceTypeName?: string | null;
  matchType?: string;
  signal?: string;
  restrictions?: string | null;
  summary?: RegulatorySummary;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
}

async function ComparisonResults({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; jurisdictions?: string }>;
}) {
  const { q, jurisdictions: jurisdictionsParam } = await searchParams;
  const query = q?.trim();

  // ── Authorization gate ──
  // Comparison is powered by the same search engine as /search, so it carries
  // the same requirement of a verified, active session. Checked here, before
  // any database work.
  const viewer = await getViewer();
  if (!viewer || !viewer.isActive) {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (jurisdictionsParam && /^[a-z0-9,-]{1,400}$/.test(jurisdictionsParam)) {
      search.set("jurisdictions", jurisdictionsParam);
    }
    const qs = search.toString();
    return (
      <SearchSignInWall
        nextPath={qs ? `/compare?${qs}` : "/compare"}
        query={query}
        title="Create a free account to compare jurisdictions"
      />
    );
  }

  if (!query) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center">
        <p className="text-sm text-neutral-500">
          Search for an activity above to build the comparison table.
        </p>
      </div>
    );
  }

  // Available jurisdictions = those with imported official activity data.
  // selectDistinctOn is required because the inner join to activities yields
  // one row per activity; without it the same jurisdiction slug repeats (e.g.
  // afz, dmcc), producing duplicate React keys in the selector and duplicate
  // fallback selection slugs.
  const availableJurisdictions = await db
    .selectDistinctOn(
      [jurisdictions.id],
      {
        id: jurisdictions.id,
        slug: jurisdictions.slug,
        name: jurisdictions.name,
        emirate: jurisdictions.emirate,
        jurisdictionType: jurisdictions.jurisdictionType,
      }
    )
    .from(jurisdictions)
    .innerJoin(activities, eq(activities.jurisdictionId, jurisdictions.id))
    .where(eq(jurisdictions.status, "active"));

  const availableSlugs = new Set(availableJurisdictions.map(j => j.slug));

  // Resolve the requested selection (URL slugs) against indexed jurisdictions.
  // Selection is re-clamped to the 2–4 range; invalid or too-small selections
  // fall back to comparing every indexed jurisdiction.
  const requested = (jurisdictionsParam ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(s => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && availableSlugs.has(s))
    .slice(0, MAX_JURISDICTIONS);

  const selected =
    requested.length >= MIN_JURISDICTIONS
      ? requested
      : availableJurisdictions.map(j => j.slug);

  let data;
  try {
    data = await searchUnified({ q: query, limit: 50, groupLimit: 3 });
  } catch {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-800">
        Something went wrong building this comparison. Please try again.
      </div>
    );
  }

  if (data.results.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
        <h2 className="text-base font-semibold text-neutral-900">
          No match found in currently indexed jurisdictions
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-neutral-600">
          &quot;{query}&quot; was not found in the official datasets indexed so
          far. This does not mean the activity is prohibited in the UAE.
        </p>
      </div>
    );
  }

  // One column per selected jurisdiction — matched or explicitly unmatched
  // (shown honestly as NO STRONG MATCH in the indexed official data).
  const columns: ComparisonColumn[] = data.jurisdictionGroups
    .filter(g => selected.includes(g.jurisdiction.slug))
    .map(g => {
      if (g.status === "no_match") {
        return {
          slug: g.jurisdiction.slug,
          name: g.jurisdiction.name,
          emirate: g.jurisdiction.emirate,
          type: g.jurisdiction.jurisdictionType,
          available: false,
        };
      }
      const top = g.topResults[0];
      return {
        slug: g.jurisdiction.slug,
        name: g.jurisdiction.name,
        emirate: g.jurisdiction.emirate,
        type: g.jurisdiction.jurisdictionType,
        available: true,
        activityId: top.activity.id,
        officialName: top.activity.officialName,
        isicCode: top.activity.isicCode,
        licenceTypeName: top.licenceType?.name ?? null,
        matchType: top.matchType,
        signal: top.activity.approvalSignal,
        sourceUrl: top.source?.url ?? null,
        sourceTitle: top.source?.title ?? null,
      };
    });

  // Enrich: regulatory summaries + restrictions for matched activities
  const matchedIds = columns
    .map(c => c.activityId)
    .filter((id): id is string => Boolean(id));

  const [summaries, restrictionRows] = await Promise.all([
    getRegulatorySummaries(matchedIds),
    matchedIds.length > 0
      ? db
          .select({ id: activities.id, restrictions: activities.restrictions })
          .from(activities)
          .where(inArray(activities.id, matchedIds))
      : Promise.resolve([] as { id: string; restrictions: string | null }[]),
  ]);

  const restrictionsById = new Map(
    restrictionRows.map(r => [r.id, r.restrictions] as const)
  );

  for (const c of columns) {
    if (c.activityId) {
      c.summary = summaries.get(c.activityId);
      c.restrictions = restrictionsById.get(c.activityId) ?? null;
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-sm font-medium text-neutral-600">
          Comparison for{" "}
          <span className="font-semibold text-neutral-900">&quot;{query}&quot;</span>{" "}
          · best-matching activity shown per jurisdiction
        </h2>
      </div>

      <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-4">
        <JurisdictionSelector
          key={selected.join(",")}
          jurisdictions={availableJurisdictions.map(j => ({ slug: j.slug, name: j.name }))}
          selected={selected}
          query={query}
        />
        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          Only jurisdictions whose official activity data has been imported are
          selectable. Differences between columns reflect indexed official
          data — never assumed values.
        </p>
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden overflow-x-auto rounded-xl border border-neutral-200 bg-white md:block">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50/80">
              <th scope="col" className="w-44 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Jurisdiction
              </th>
              {columns.map(c => (
                <th key={c.slug} scope="col" className="px-4 py-3 text-left align-top">
                  <Link
                    href={`/jurisdictions/${c.slug}`}
                    className="font-semibold text-neutral-900 hover:text-blue-700 hover:underline"
                  >
                    {c.name}
                  </Link>
                  <p className="mt-0.5 text-[11px] font-normal text-neutral-500">
                    {formatEmirate(c.emirate)} ·{" "}
                    {formatJurisdictionType(c.type)}
                  </p>
                  <div className="mt-1.5">
                    {c.available ? (
                      <MatchTypeBadge matchType={c.matchType ?? "related"} />
                    ) : (
                      <span className="inline-flex items-center rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                        No match in indexed data
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            <Row label="Activity">
              {columns.map(c =>
                c.available ? (
                  <td key={c.slug} className="px-4 py-3">
                    <Link
                      href={`/activities/${c.activityId}`}
                      className="font-medium text-neutral-900 hover:text-blue-700 hover:underline"
                    >
                      {c.officialName}
                    </Link>
                  </td>
                ) : (
                  <UnavailableCell key={c.slug} />
                )
              )}
            </Row>
            <Row label="ISIC Code">
              {columns.map(c =>
                c.available ? (
                  <td key={c.slug} className="px-4 py-3 font-mono text-xs text-neutral-600">
                    {c.isicCode ?? "—"}
                  </td>
                ) : (
                  <UnavailableCell key={c.slug} />
                )
              )}
            </Row>
            <Row label="Licence type">
              {columns.map(c =>
                c.available ? (
                  <td key={c.slug} className="px-4 py-3 text-neutral-700">
                    {c.licenceTypeName ?? "Not specified in source"}
                  </td>
                ) : (
                  <UnavailableCell key={c.slug} />
                )
              )}
            </Row>
            <Row label="Approval status">
              {columns.map(c =>
                c.available ? (
                  <td key={c.slug} className="px-4 py-3">
                    {(c.summary?.verifiedApprovals.length ?? 0) > 0 ? (
                      <VerifiedBadge label="Verified approval" />
                    ) : c.signal === "third_party_approval_indicated" ||
                      c.signal === "may_be_required" ? (
                      <ApprovalSignalBadgeSmall />
                    ) : (
                      <ResearchRequiredBadge />
                    )}
                  </td>
                ) : (
                  <UnavailableCell key={c.slug} />
                )
              )}
            </Row>
            <Row label="Verified approval">
              {columns.map(c =>
                c.available ? (
                  <td key={c.slug} className="px-4 py-3 text-neutral-700">
                    {c.summary && c.summary.verifiedApprovals.length > 0 ? (
                      <ul className="space-y-0.5">
                        {c.summary.verifiedApprovals.map((va, i) => (
                          <li key={i}>
                            {va.name}
                            {va.authorityName && (
                              <span className="text-xs text-neutral-500"> ({va.authorityName})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-neutral-500">Not verified</span>
                    )}
                  </td>
                ) : (
                  <UnavailableCell key={c.slug} />
                )
              )}
            </Row>
            <Row label="Government fee">
              {columns.map(c =>
                c.available ? (
                  <td key={c.slug} className="px-4 py-3 text-neutral-700">
                    {c.summary && c.summary.govFees.length > 0 ? (
                      <ul className="space-y-0.5">
                        {c.summary.govFees.map((f, i) => (
                          <li key={i}>
                            <span className="font-semibold">{formatAed(f.amount)}</span>{" "}
                            <span className="text-xs text-neutral-500">
                              ({titleCaseEnum(f.feeType)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-neutral-500">
                        Not verified/published in indexed official sources.
                      </span>
                    )}
                  </td>
                ) : (
                  <UnavailableCell key={c.slug} />
                )
              )}
            </Row>
            <Row label="Third-party cost">
              {columns.map(c =>
                c.available ? (
                  <td key={c.slug} className="px-4 py-3 text-neutral-700">
                    {c.summary && c.summary.thirdPartyCosts.length > 0 ? (
                      <ul className="space-y-0.5">
                        {c.summary.thirdPartyCosts.map((t, i) => (
                          <li key={i}>
                            {t.estimatedAmount !== null
                              ? formatAed(t.estimatedAmount)
                              : `${t.currency || ""} varies`}{" "}
                            <span className="text-xs text-neutral-500">
                              ({titleCaseEnum(t.costType)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-neutral-500">Not verified</span>
                    )}
                  </td>
                ) : (
                  <UnavailableCell key={c.slug} />
                )
              )}
            </Row>
            <Row label="Restrictions">
              {columns.map(c =>
                c.available ? (
                  <td key={c.slug} className="px-4 py-3 text-xs leading-relaxed text-neutral-600">
                    {c.restrictions ?? "None published in indexed sources"}
                  </td>
                ) : (
                  <UnavailableCell key={c.slug} />
                )
              )}
            </Row>
            <Row label="Source">
              {columns.map(c =>
                c.available ? (
                  <td key={c.slug} className="px-4 py-3">
                    {c.sourceUrl ? (
                      <a
                        href={c.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-sky-700 hover:text-sky-900 hover:underline"
                      >
                        Official source ↗
                      </a>
                    ) : (
                      <span className="text-xs text-neutral-500">Not verified</span>
                    )}
                  </td>
                ) : (
                  <UnavailableCell key={c.slug} />
                )
              )}
            </Row>
          </tbody>
        </table>
      </div>

      {/* ── Mobile stacked cards ── */}
      <div className="space-y-4 md:hidden">
        {columns.map(c => (
          <div
            key={c.slug}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white"
          >
            <div
              className={`flex items-center justify-between gap-2 px-4 py-3 ${
                c.available ? "bg-emerald-50/60" : "bg-neutral-50"
              }`}
            >
              <div>
                <Link
                  href={`/jurisdictions/${c.slug}`}
                  className="font-semibold text-neutral-900 hover:text-blue-700"
                >
                  {c.name}
                </Link>
                <p className="text-[11px] text-neutral-500">
                  {formatEmirate(c.emirate)} · {formatJurisdictionType(c.type)}
                </p>
              </div>
              {c.available ? (
                <span className="shrink-0">
                  <MatchTypeBadge matchType={c.matchType ?? "related"} />
                </span>
              ) : (
                <span className="shrink-0 rounded-md border border-neutral-200 bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                  No match in indexed data
                </span>
              )}
            </div>
            {c.available ? (
              <dl className="divide-y divide-neutral-100 text-sm">
                <MobileRow label="Activity">
                  <Link href={`/activities/${c.activityId}`} className="font-medium text-blue-700">
                    {c.officialName}
                  </Link>
                </MobileRow>
                <MobileRow label="ISIC Code">
                  <span className="font-mono text-xs">{c.isicCode ?? "—"}</span>
                </MobileRow>
                <MobileRow label="Licence type">
                  {c.licenceTypeName ?? "Not specified in source"}
                </MobileRow>
                <MobileRow label="Approval status">
                  {(c.summary?.verifiedApprovals.length ?? 0) > 0 ? (
                    <VerifiedBadge label="Verified approval" />
                  ) : c.signal === "third_party_approval_indicated" ||
                    c.signal === "may_be_required" ? (
                    <ApprovalSignalBadgeSmall />
                  ) : (
                    <ResearchRequiredBadge />
                  )}
                </MobileRow>
                <MobileRow label="Government fee">
                  {c.summary && c.summary.govFees.length > 0 ? (
                    formatAed(c.summary.govFees[0].amount)
                  ) : (
                    <span className="text-xs text-neutral-500">
                      Not verified/published in indexed official sources.
                    </span>
                  )}
                </MobileRow>
                <MobileRow label="Third-party cost">
                  {c.summary && c.summary.thirdPartyCosts.length > 0
                    ? c.summary.thirdPartyCosts[0].estimatedAmount !== null
                      ? formatAed(c.summary.thirdPartyCosts[0].estimatedAmount)
                      : "varies"
                    : "Not verified"}
                </MobileRow>
                <MobileRow label="Restrictions">
                  <span className="text-xs">{c.restrictions ?? "None published in indexed sources"}</span>
                </MobileRow>
                <MobileRow label="Source">
                  {c.sourceUrl ? (
                    <a
                      href={c.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-sky-700 underline"
                    >
                      Official source ↗
                    </a>
                  ) : (
                    <span className="text-xs text-neutral-500">Not verified</span>
                  )}
                </MobileRow>
              </dl>
            ) : (
              <p className="px-4 py-4 text-xs leading-relaxed text-neutral-500">
                No match was found for this activity in{" "}
                {c.name}&apos;s currently indexed official dataset. This does
                not mean the activity is prohibited or unavailable.
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="mt-8 rounded-lg border border-neutral-200 bg-white p-4 text-xs leading-relaxed text-neutral-500">
        Each column shows the single best-matching activity for the searched
        term in that jurisdiction. Unknown information remains marked
        &quot;Not verified&quot; rather than assumed absent. Approval signals are
        not verified approvals — always confirm requirements with the relevant
        authority before applying.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th
        scope="row"
        className="w-44 bg-neutral-50/60 px-4 py-3 text-left align-top text-xs font-semibold uppercase tracking-wide text-neutral-500"
      >
        {label}
      </th>
      {children}
    </tr>
  );
}

function UnavailableCell() {
  return (
    <td className="px-4 py-3 text-xs text-neutral-500" aria-label="No match found in indexed data">
      No match in indexed data
    </td>
  );
}

function MobileRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="min-w-0 text-right text-neutral-700">{children}</dd>
    </div>
  );
}

function CompareSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading comparison">
      <div className="h-8 w-64 animate-pulse rounded bg-neutral-200/70" />
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="h-28 w-full animate-pulse rounded-xl border border-neutral-100 bg-white"
        />
      ))}
    </div>
  );
}
