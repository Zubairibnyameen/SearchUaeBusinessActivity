import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activities,
  jurisdictions,
  licenceTypes,
  sources,
  activitySources,
} from "@/lib/db/schema";
import {
  approvals,
  approvalFees,
} from "@/lib/db/schema/approvals";
import {
  VerifiedBadge,
  OfficialSourceBadge,
} from "@/components/ui/verification-badges";
import {
  formatAed,
  formatDate,
  formatEmirate,
  formatJurisdictionType,
  titleCaseEnum,
} from "@/lib/format";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function getIndexedJurisdiction(slug: string) {
  const rows = await db
    .select({
      j: jurisdictions,
      activityCount: sql<number>`COUNT(${activities.id})::int`,
    })
    .from(jurisdictions)
    .leftJoin(activities, eq(activities.jurisdictionId, jurisdictions.id))
    .where(eq(jurisdictions.slug, slug))
    .groupBy(jurisdictions.id)
    .limit(1);
  const row = rows[0];
  if (!row || row.activityCount === 0) return null;
  return { ...row.j, activityCount: row.activityCount };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return { title: "Jurisdiction not found" };
  const j = await getIndexedJurisdiction(slug);
  if (!j) return { title: "Jurisdiction not found" };

  return {
    title: `${j.name} (${formatEmirate(j.emirate)}) — Activities, Licences & Approvals`,
    description: `${j.name} business activities indexed from official sources: ${formatJurisdictionType(j.jurisdictionType)} authority in ${formatEmirate(j.emirate)}. Browse activities, licence types, approval status and verified government fees.`,
    alternates: { canonical: `/jurisdictions/${j.slug}` },
  };
}

export default async function JurisdictionDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();

  // Public pages exist ONLY for authorities whose official activity data has
  // actually been imported (activity count > 0). The registry contains
  // placeholder rows for un-imported authorities — those get no page.
  const j = await getIndexedJurisdiction(slug);
  if (!j) notFound();

  // Core counts
  const [activityAgg] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(activities)
    .where(eq(activities.jurisdictionId, j.id));

  const licenceTypeRows = await db
    .select({
      id: licenceTypes.id,
      name: licenceTypes.name,
      code: licenceTypes.code,
      count: sql<number>`COUNT(${activities.id})::int`,
    })
    .from(licenceTypes)
    .innerJoin(activities, eq(activities.licenceTypeId, licenceTypes.id))
    .where(eq(activities.jurisdictionId, j.id))
    .groupBy(licenceTypes.id, licenceTypes.name, licenceTypes.code)
    .orderBy(sql`COUNT(${activities.id}) DESC`)
    .limit(12);

  // Approval coverage — three-state, honest
  const signalBreakdownRows = await db
    .select({
      signal: activities.approvalSignal,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(activities)
    .where(eq(activities.jurisdictionId, j.id))
    .groupBy(activities.approvalSignal);

  const signalByValue = new Map(signalBreakdownRows.map(r => [r.signal, r.count]));
  const signalCount =
    (signalByValue.get("third_party_approval_indicated") ?? 0) +
    (signalByValue.get("may_be_required") ?? 0);
  const unknownCount = signalByValue.get("unknown") ?? 0;

  const [verifiedApprovalAgg] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(approvals)
    .innerJoin(activities, eq(approvals.activityId, activities.id))
    .where(
      and(
        eq(activities.jurisdictionId, j.id),
        eq(approvals.verificationStatus, "verified")
      )
    );

  // Verified fee coverage — through the approvals table only
  const jurisdictionActivityIds = await db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.jurisdictionId, j.id));
  const ids = jurisdictionActivityIds.map(r => r.id);

  let verifiedFeeCount = 0;
  if (ids.length > 0) {
    const [feeAgg] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(approvalFees)
      .innerJoin(approvals, eq(approvalFees.approvalId, approvals.id))
      .where(
        and(inArray(approvals.activityId, ids), eq(approvals.verificationStatus, "verified"))
      );
    verifiedFeeCount = feeAgg?.count ?? 0;
  }

  // Verified fee details (government / regulatory) — from verified approvals
  // only. Kept separate from licence prices and third-party costs. When fees
  // are absent the section states exactly that — never AED 0.
  let verifiedFeeRecords: {
    approvalName: string;
    amount: string | null;
    feeType: string;
  }[] = [];
  if (ids.length > 0) {
    verifiedFeeRecords = await db
      .selectDistinct({
        approvalName: approvals.name,
        amount: approvalFees.amount,
        feeType: approvalFees.feeType,
      })
      .from(approvalFees)
      .innerJoin(approvals, eq(approvalFees.approvalId, approvals.id))
      .where(
        and(inArray(approvals.activityId, ids), eq(approvals.verificationStatus, "verified"))
      );
  }

  // Sources & last verification info — includes BOTH activity-listing
  // sources and approval/fee sources linked to this jurisdiction.
  const [activitySourceRows, approvalSourceRows] = await Promise.all([
    ids.length > 0
      ? db
          .selectDistinct({
            id: sources.id,
            url: sources.url,
            title: sources.title,
            authority: sources.authority,
            retrievedDate: sources.retrievedDate,
            lastVerified: sources.lastVerified,
          })
          .from(activitySources)
          .innerJoin(sources, eq(activitySources.sourceId, sources.id))
          .where(inArray(activitySources.activityId, ids))
      : Promise.resolve([]),
    ids.length > 0
      ? db
          .selectDistinct({
            id: sources.id,
            url: sources.url,
            title: sources.title,
            authority: sources.authority,
            retrievedDate: sources.retrievedDate,
            lastVerified: sources.lastVerified,
          })
          .from(approvals)
          .innerJoin(sources, eq(sources.id, approvals.sourceId))
          .where(inArray(approvals.activityId, ids))
      : Promise.resolve([]),
  ]);
  const sourceMap = new Map<
    string,
    {
      id: string;
      url: string;
      title: string | null;
      authority: string | null;
      retrievedDate: string | null;
      lastVerified: string | null;
    }
  >();
  for (const s of [...activitySourceRows, ...approvalSourceRows]) sourceMap.set(s.id, s);
  const sourceRows = [...sourceMap.values()].slice(0, 8);

  const [lastVerifiedAgg] = await db
    .select({
      maxLastVerified: sql<string | null>`MAX(${activities.lastVerified})`,
    })
    .from(activities)
    .where(eq(activities.jurisdictionId, j.id));

  const activityCount = activityAgg?.count ?? 0;

  return (
    <div className="bg-neutral-50">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1.5 text-sm text-neutral-500">
          <Link href="/" className="hover:text-neutral-800">Home</Link>
          <span aria-hidden>/</span>
          <Link href="/jurisdictions" className="hover:text-neutral-800">Jurisdictions</Link>
          <span aria-hidden>/</span>
          <span className="text-neutral-800">{j.name}</span>
        </nav>

        {/* Header */}
        <header className="rounded-xl border border-neutral-200 bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {formatJurisdictionType(j.jurisdictionType)} · {formatEmirate(j.emirate)}
              </span>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
                {j.name}
              </h1>
              {j.description && (
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-600">
                  {j.description}
                </p>
              )}
              {j.officialWebsite && (
                <p className="mt-3 text-sm">
                  <a
                    href={j.officialWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {j.officialWebsite.replace(/^https?:\/\//, "")} ↗
                  </a>
                </p>
              )}
            </div>
            {/* Scoped activity search */}
            <div className="flex w-full max-w-sm flex-col items-stretch gap-3 sm:items-end">
              <form
                action="/search"
                method="GET"
                role="search"
                className="flex w-full items-center gap-2"
              >
                <input type="hidden" name="jurisdiction" value={j.slug} />
                <label htmlFor={`search-${j.slug}`} className="sr-only">
                  Search activities in {j.name}
                </label>
                <input
                  id={`search-${j.slug}`}
                  type="text"
                  name="q"
                  required
                  placeholder={`Search ${j.name} activities…`}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm placeholder:text-neutral-500 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
                >
                  Search
                </button>
              </form>
              <Link
                href={`/activities?jurisdiction=${j.slug}`}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-3.5 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
              >
                Browse all {activityCount.toLocaleString()}{" "}
                {activityCount === 1 ? "activity" : "activities"}
                <span aria-hidden>&rarr;</span>
              </Link>
              <Link
                href={`/compare?jurisdictions=${j.slug}`}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-3.5 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
              >
                Compare this jurisdiction
                <span aria-hidden>&rarr;</span>
              </Link>
            </div>
          </div>
        </header>

        {/* Coverage stats */}
        <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Activities indexed" value={activityCount.toLocaleString()} />
          <StatCard label="Verified approvals" value={verifiedApprovalAgg?.count.toLocaleString() ?? "0"} accent />
          <StatCard label="Activities w/ approval signals" value={signalCount.toLocaleString()} />
          <StatCard label="Verified gov fee records" value={verifiedFeeCount.toLocaleString()} accent />
        </dl>

        <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Approval coverage
          </h2>
          <ul className="space-y-1.5 text-sm text-neutral-700">
            <li>
              <span className="font-semibold tabular-nums">{verifiedApprovalAgg?.count ?? 0}</span>{" "}
              activities have a VERIFIED regulatory approval on record.
            </li>
            <li>
              <span className="font-semibold tabular-nums">{signalCount}</span>{" "}
              activities carry an APPROVAL SIGNAL from the official listing
              (third-party involvement indicated — not yet independently
              verified).
            </li>
            <li>
              <span className="font-semibold tabular-nums">{unknownCount}</span>{" "}
              activities remain UNKNOWN / research required.
            </li>
          </ul>
          <p className="mt-3 border-t border-neutral-100 pt-3 text-xs leading-relaxed text-neutral-500">
            The number of indexed activities reflects what was captured from{" "}
            {j.name}&apos;s official activity publication at verification time.
            It does not imply this is the complete list of activities the
            authority offers.
          </p>
        </div>

        {/* Licence types */}
        <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-neutral-500">
            Licence types
          </h2>
          {licenceTypeRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                    <th scope="col" className="py-2 pr-4 font-medium">Licence type</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Code</th>
                    <th scope="col" className="py-2 text-right font-medium">Activities</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {licenceTypeRows.map(lt => (
                    <tr key={lt.id}>
                      <td className="py-2.5 pr-4 font-medium text-neutral-800">{lt.name}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-neutral-500">
                        {lt.code ?? "—"}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-neutral-600">
                        {lt.count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-neutral-500">
              No licence-type records are linked to indexed activities for this
              jurisdiction yet.
            </p>
          )}
        </section>

        {/* Verified government fees */}
        <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-neutral-500">
            Verified government fees
          </h2>
          {verifiedFeeRecords.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                      <th scope="col" className="py-2 pr-4 font-medium">Approval</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Fee type</th>
                      <th scope="col" className="py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {verifiedFeeRecords.map((f, i) => (
                      <tr key={i}>
                        <td className="py-2.5 pr-4 font-medium text-neutral-800">
                          {f.approvalName}
                        </td>
                        <td className="py-2.5 pr-4 text-neutral-600">
                          {titleCaseEnum(f.feeType)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700">
                          {formatAed(f.amount) ?? "Amount not published"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 border-t border-neutral-100 pt-3 text-xs leading-relaxed text-neutral-500">
                These are verified government / regulatory approval fees from
                indexed sources. They are separate from licence prices and any
                third-party costs.
              </p>
            </>
          ) : (
            <p className="text-sm text-neutral-500">
              No verified government approval fee is currently available in the
              indexed data.
            </p>
          )}
        </section>

        {/* Sources & verification */}
        <section className="mb-8 mt-6 rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-neutral-500">
            Official sources &amp; verification
          </h2>
          {sourceRows.length > 0 ? (
            <ul className="space-y-3">
              {sourceRows.map((s, idx) => (
                <li key={s.id} className="rounded-lg border border-neutral-100 bg-neutral-50/60 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <OfficialSourceBadge href={s.url} title={s.title} />
                    <span className="text-sm font-medium text-neutral-800">
                      {s.title || s.url}
                    </span>
                    {idx === 0 && <VerifiedBadge />}
                  </div>
                  <p className="mt-1.5 text-xs text-neutral-500">
                    Authority: {s.authority ?? j.name} · Retrieved:{" "}
                    {s.retrievedDate ? formatDate(s.retrievedDate) : "—"} · Last
                    verified:{" "}
                    {s.lastVerified ? formatDate(s.lastVerified) : "not independently verified"}
                  </p>
                  <p className="mt-1 break-all text-xs">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 hover:underline"
                    >
                      {s.url}
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">
              No official source records are linked to this jurisdiction&apos;s
              indexed activities yet.
            </p>
          )}
          <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
            Most recent activity-level verification:{" "}
            {lastVerifiedAgg?.maxLastVerified
              ? formatDate(lastVerifiedAgg.maxLastVerified)
              : "never"}
            . Verification dates reflect when indexed data was last checked
            against its official source.
          </p>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        accent ? "border-emerald-200 bg-emerald-50/60" : "border-neutral-200 bg-white"
      }`}
    >
      <dd
        className={`text-2xl font-bold tabular-nums tracking-tight ${
          accent ? "text-emerald-900" : "text-neutral-900"
        }`}
      >
        {value}
      </dd>
      <dt
        className={`mt-1 text-xs font-medium uppercase tracking-wide ${
          accent ? "text-emerald-700" : "text-neutral-500"
        }`}
      >
        {label}
      </dt>
    </div>
  );
}
