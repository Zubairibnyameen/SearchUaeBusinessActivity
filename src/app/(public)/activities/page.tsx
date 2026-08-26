import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, jurisdictions, licenceTypes } from "@/lib/db/schema";
import { VerifiedBadge, ApprovalSignalBadgeSmall } from "@/components/ui/verification-badges";

export const metadata: Metadata = {
  title: "Browse Business Activities",
  description:
    "Browse thousands of official UAE business activities across DMCC, IFZA, RAKEZ, SPC Free Zone and Ajman Free Zone with licence types and approval status.",
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; jurisdiction?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  // Optional jurisdiction scope
  const slug = params.jurisdiction?.trim();
  let scopedJurisdiction: { id: string; name: string; slug: string } | null = null;
  if (slug && SLUG_RE.test(slug)) {
    const rows = await db
      .select({ id: jurisdictions.id, name: jurisdictions.name, slug: jurisdictions.slug })
      .from(jurisdictions)
      .where(eq(jurisdictions.slug, slug))
      .limit(1);
    if (rows[0]) scopedJurisdiction = rows[0];
  }

  const whereClause = scopedJurisdiction
    ? eq(activities.jurisdictionId, scopedJurisdiction.id)
    : undefined;

  const [countAgg] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(activities)
    .where(whereClause);

  const rows = await db
    .select({
      id: activities.id,
      officialName: activities.officialName,
      activityCode: activities.activityCode,
      approvalSignal: activities.approvalSignal,
      verificationStatus: activities.verificationStatus,
      jurisdictionName: jurisdictions.name,
      jurisdictionSlug: jurisdictions.slug,
      emirate: jurisdictions.emirate,
      licenceTypeName: licenceTypes.name,
    })
    .from(activities)
    .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
    .leftJoin(licenceTypes, eq(activities.licenceTypeId, licenceTypes.id))
    .where(whereClause)
    .orderBy(asc(jurisdictions.name), asc(activities.officialName))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const total = countAgg?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Only authorities with actually-imported activity data get filter pills.
  const jurisdictionOptions = (
    await db
      .select({
        slug: jurisdictions.slug,
        name: jurisdictions.name,
        activityCount: sql<number>`COUNT(${activities.id})::int`,
      })
      .from(jurisdictions)
      .innerJoin(activities, eq(activities.jurisdictionId, jurisdictions.id))
      .where(eq(jurisdictions.status, "active"))
      .groupBy(jurisdictions.slug, jurisdictions.name)
      .orderBy(jurisdictions.name)
  ).filter(jo => jo.activityCount > 0);

  return (
    <div className="bg-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
              Business Activities
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
              {total.toLocaleString()} official{" "}
              {total === 1 ? "activity" : "activities"} indexed from verified
              authority publications
              {scopedJurisdiction ? (
                <>
                  {" "}
                  in{" "}
                  <Link
                    href={`/jurisdictions/${scopedJurisdiction.slug}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {scopedJurisdiction.name}
                  </Link>
                </>
              ) : null}
              . Looking for something specific?{" "}
              <Link href="/search" className="font-medium text-blue-700 hover:underline">
                Use activity search
              </Link>{" "}
              to match your business idea.
            </p>
          </div>

          {/* Filters */}
          <nav aria-label="Filter by jurisdiction" className="flex flex-wrap gap-2">
            <Link
              href="/activities"
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                !scopedJurisdiction
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
              }`}
            >
              All
            </Link>
            {jurisdictionOptions.map(jo => (
              <Link
                key={jo.slug}
                href={`/activities?jurisdiction=${jo.slug}`}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  scopedJurisdiction?.slug === jo.slug
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                }`}
              >
                {jo.name}
              </Link>
            ))}
          </nav>
        </header>

        {rows.length > 0 ? (
          <>
            {/* Desktop table */}
            <div className="mt-6 hidden overflow-hidden rounded-xl border border-neutral-200 bg-white md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50/80 text-left text-xs uppercase tracking-wide text-neutral-400">
                    <th className="px-4 py-3 font-medium">Activity</th>
                    <th className="px-4 py-3 font-medium">Jurisdiction</th>
                    <th className="px-4 py-3 font-medium">Licence type</th>
                    <th className="px-4 py-3 font-medium">Approval status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rows.map(r => (
                    <tr key={r.id} className="transition-colors hover:bg-neutral-50/70">
                      <td className="px-4 py-3">
                        <Link
                          href={`/activities/${r.id}`}
                          className="font-medium text-neutral-900 hover:text-blue-700 hover:underline"
                        >
                          {r.officialName}
                        </Link>
                        {r.activityCode && (
                          <span className="ml-2 font-mono text-xs text-neutral-400">
                            {r.activityCode}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">
                        <Link
                          href={`/jurisdictions/${r.jurisdictionSlug}`}
                          className="hover:text-blue-700 hover:underline"
                        >
                          {r.jurisdictionName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-neutral-600">
                        {r.licenceTypeName ?? (
                          <span className="text-neutral-400">Not specified</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ApprovalStatusInline
                          verificationStatus={r.verificationStatus}
                          signal={r.approvalSignal}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="mt-6 space-y-3 md:hidden">
              {rows.map(r => (
                <li key={r.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                  <Link
                    href={`/activities/${r.id}`}
                    className="font-medium leading-snug text-neutral-900"
                  >
                    {r.officialName}
                  </Link>
                  {r.activityCode && (
                    <span className="ml-2 font-mono text-xs text-neutral-400">
                      {r.activityCode}
                    </span>
                  )}
                  <p className="mt-1 text-xs text-neutral-500">
                    {r.jurisdictionName} · {r.emirate.replace(/_/g, " ")}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {r.licenceTypeName ?? "Licence type not specified"}
                  </p>
                  <div className="mt-2">
                    <ApprovalStatusInline
                      verificationStatus={r.verificationStatus}
                      signal={r.approvalSignal}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <nav
                aria-label="Activity pages"
                className="mt-8 flex items-center justify-center gap-2"
              >
                {page > 1 ? (
                  <Link
                    href={pageHref(scopedJurisdiction?.slug, page - 1)}
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
                  Page {page} of {totalPages.toLocaleString()}
                </span>
                {page < totalPages ? (
                  <Link
                    href={pageHref(scopedJurisdiction?.slug, page + 1)}
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
          </>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center">
            <p className="text-sm text-neutral-500">
              No activities are indexed for this selection yet.
            </p>
          </div>
        )}

        <p className="mt-8 rounded-lg border border-neutral-200 bg-white p-4 text-xs leading-relaxed text-neutral-500">
          This listing shows every indexed record — it is a data-provenance
          view, not a recommendation of completeness. Approval status is shown
          using the three-state model: verified approvals, signals from official
          listings, and unknown/research-required.
        </p>
      </div>
    </div>
  );
}

function pageHref(
  jurisdiction: string | undefined | null,
  page: number
): string {
  const params = new URLSearchParams();
  if (jurisdiction) params.set("jurisdiction", jurisdiction);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/activities?${qs}` : "/activities";
}

function ApprovalStatusInline({
  verificationStatus,
  signal,
}: {
  verificationStatus: string;
  signal: string;
}) {
  if (verificationStatus === "verified") {
    return <VerifiedBadge />;
  }
  if (signal === "third_party_approval_indicated" || signal === "may_be_required") {
    return <ApprovalSignalBadgeSmall />;
  }
  if (signal === "restricted") {
    return (
      <span className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
        Restricted
      </span>
    );
  }
  if (signal === "no_signal") {
    return (
      <span className="inline-flex items-center rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        No signal in source
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
      Research required
    </span>
  );
}
