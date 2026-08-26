import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activities,
  jurisdictions,
  licenceTypes,
  sources,
  activitySources,
} from "@/lib/db/schema";
import {
  activityApprovalSignals,
  activitySourcePrices,
} from "@/lib/db/schema/signals";
import {
  approvals,
  approvalAuthorities,
  approvalFees,
  thirdPartyCosts,
} from "@/lib/db/schema/approvals";
import {
  VerifiedBadge,
  OfficialSourceBadge,
} from "@/components/ui/verification-badges";
import {
  formatDate,
  formatEmirate,
  formatJurisdictionType,
  titleCaseEnum,
} from "@/lib/format";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FEE_ABSENCE_NOTICE =
  "Fee not verified/published in indexed official sources.";
const TPC_ABSENCE_NOTICE =
  "No third-party cost has been verified/published in indexed official sources. Where an approval signal indicates an external authority, costs must be confirmed directly with that authority.";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Activity not found" };

  const rows = await db
    .select({
      name: activities.officialName,
      code: activities.activityCode,
      jurisdiction: jurisdictions.name,
      emirate: jurisdictions.emirate,
    })
    .from(activities)
    .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
    .where(eq(activities.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return { title: "Activity not found" };

  return {
    title: `${row.name}${row.code ? ` (${row.code})` : ""} — ${row.jurisdiction}`,
    description: `${row.name} business activity in ${row.jurisdiction} (${formatEmirate(row.emirate)}): licence type, approval status, government fees and official source verification.`,
  };
}

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const rows = await db
    .select({
      activity: activities,
      jurisdiction: jurisdictions,
      licenceType: licenceTypes,
    })
    .from(activities)
    .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
    .leftJoin(licenceTypes, eq(activities.licenceTypeId, licenceTypes.id))
    .where(eq(activities.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();

  const a = row.activity;
  const j = row.jurisdiction;

  const [linkedSources, signals, prices] = await Promise.all([
    db
      .select({ source: sources })
      .from(activitySources)
      .innerJoin(sources, eq(activitySources.sourceId, sources.id))
      .where(eq(activitySources.activityId, id)),
    db
      .select()
      .from(activityApprovalSignals)
      .where(eq(activityApprovalSignals.activityId, id)),
    db
      .select()
      .from(activitySourcePrices)
      .where(eq(activitySourcePrices.activityId, id)),
  ]);

  // Verified regulatory records live in strictly-verified tables and are
  // expected to be sparse. Fees and third-party costs are ALWAYS queried
  // through their own tables — never derived from activity prices.
  const approvalRows = await db
    .select({
      approval: approvals,
      authority: approvalAuthorities,
      source: sources,
    })
    .from(approvals)
    .leftJoin(
      approvalAuthorities,
      eq(approvalAuthorities.id, approvals.approvalAuthorityId)
    )
    .leftJoin(sources, eq(sources.id, approvals.sourceId))
    .where(eq(approvals.activityId, id));

  const approvalIds = approvalRows.map(r => r.approval.id);
  const [feeRecords, tpcRecords] =
    approvalIds.length > 0
      ? await Promise.all([
          db.select().from(approvalFees).where(inArray(approvalFees.approvalId, approvalIds)),
          db.select().from(thirdPartyCosts).where(inArray(thirdPartyCosts.approvalId, approvalIds)),
        ])
      : [[], []];

  const verifiedApprovals = approvalRows.filter(
    r => r.approval.verificationStatus === "verified"
  );
  const primarySource = linkedSources[0]?.source ?? null;
  const hasVerifiedAnything = verifiedApprovals.length > 0;

  // ── Related activities: same jurisdiction, shared group or category ─────
  const relatedConds = [
    a.activityGroup ? eq(activities.activityGroup, a.activityGroup) : undefined,
    a.officialCategory
      ? eq(activities.officialCategory, a.officialCategory)
      : undefined,
  ].filter((c): c is SQL<unknown> => Boolean(c));
  const relatedMatch =
    relatedConds.length === 2
      ? or(...relatedConds)
      : relatedConds[0];
  const relatedActivities = relatedMatch
    ? await db
        .select({
          id: activities.id,
          officialName: activities.officialName,
          activityCode: activities.activityCode,
        })
        .from(activities)
        .where(
          and(
            eq(activities.jurisdictionId, j.id),
            ne(activities.id, id),
            relatedMatch
          )
        )
        .limit(6)
    : [];

  // ── Similar jurisdictions: other authorities listing this group/category ─
  const similarityConds = [
    a.activityGroup ? eq(activities.activityGroup, a.activityGroup) : undefined,
    a.officialCategory
      ? eq(activities.officialCategory, a.officialCategory)
      : undefined,
  ].filter((c): c is SQL<unknown> => Boolean(c));
  const similarityMatch =
    similarityConds.length === 2
      ? or(...similarityConds)
      : similarityConds[0];
  const similarJurisdictions = similarityMatch
    ? await db
        .select({
          slug: jurisdictions.slug,
          name: jurisdictions.name,
          emirate: jurisdictions.emirate,
          type: jurisdictions.jurisdictionType,
          matches: sql<number>`COUNT(*)::int`,
        })
        .from(activities)
        .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
        .where(
          and(
            ne(activities.jurisdictionId, j.id),
            eq(jurisdictions.status, "active"),
            similarityMatch
          )
        )
        .groupBy(
          jurisdictions.slug,
          jurisdictions.name,
          jurisdictions.emirate,
          jurisdictions.jurisdictionType
        )
        .orderBy(desc(sql`COUNT(*)`))
        .limit(5)
    : [];

  return (
    <div className="bg-neutral-50">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1.5 text-sm text-neutral-500">
          <Link href="/" className="hover:text-neutral-800">Home</Link>
          <span aria-hidden>/</span>
          <Link href="/jurisdictions" className="hover:text-neutral-800">Jurisdictions</Link>
          <span aria-hidden>/</span>
          <Link href={`/jurisdictions/${j.slug}`} className="hover:text-neutral-800">{j.name}</Link>
        </nav>

        {/* Page heading */}
        <header className="rounded-xl border border-neutral-200 bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {hasVerifiedAnything && <VerifiedBadge label="Contains verified regulatory data" />}
                {primarySource?.url && <OfficialSourceBadge href={primarySource.url} title={primarySource.title} />}
              </div>
              <h1 className="text-2xl font-bold leading-snug tracking-tight text-neutral-900 sm:text-3xl">
                {a.officialName}
              </h1>
              {a.officialNameAr && (
                <p className="mt-2 text-lg text-neutral-600" dir="rtl" lang="ar">
                  {a.officialNameAr}
                </p>
              )}
              <p className="mt-3 text-sm text-neutral-500">
                {j.name} · {formatEmirate(j.emirate)} ·{" "}
                {formatJurisdictionType(j.jurisdictionType)}
                {a.activityCode && (
                  <>
                    {" "}· <span className="font-mono">Code {a.activityCode}</span>
                  </>
                )}
              </p>
            </div>
            <Link
              href={`/jurisdictions/${j.slug}`}
              className="shrink-0 rounded-lg border border-neutral-200 px-3.5 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
            >
              About {j.name}
            </Link>
          </div>
        </header>

        <div className="mt-6 space-y-6">
          {/* ── 1. ACTIVITY OVERVIEW ──────────────────────────────────── */}
          <Section number={1} title="Activity overview">
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Official name">{a.officialName}</Field>
              <Field label="Activity code">
                {a.activityCode ? (
                  <span className="font-mono">{a.activityCode}</span>
                ) : (
                  <Muted>Not assigned</Muted>
                )}
              </Field>
              <Field label="Activity group">
                {a.activityGroup ?? <Muted>Not specified</Muted>}
              </Field>
              <Field label="Category">
                {a.officialCategory ?? <Muted>Not specified</Muted>}
              </Field>
              <Field label="Verification status">
                {a.verificationStatus === "verified" ? (
                  <VerifiedBadge />
                ) : (
                  <Muted>{titleCaseEnum(a.verificationStatus)}</Muted>
                )}
              </Field>
              <Field label="Last verified">
                {a.lastVerified ? formatDate(a.lastVerified) : <Muted>Never independently verified</Muted>}
              </Field>
            </dl>
            {typeof a.description === "string" && a.description.length > 0 && (
              <div className="mt-4 border-t border-neutral-100 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  Official description
                </p>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-neutral-700">
                  {a.description}
                </p>
              </div>
            )}
          </Section>

          {/* ── 2. LICENCE INFORMATION ────────────────────────────────── */}
          <Section number={2} title="Licence information">
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Licence type">
                {row.licenceType ? (
                  row.licenceType.name
                ) : (
                  <Muted>Not specified in source</Muted>
                )}
              </Field>
              <Field label="Zone">
                {a.zone ?? <Muted>Not applicable</Muted>}
              </Field>
            </dl>

            {/* Licence/activity price is a LICENCE fact — kept clearly separate
                from government fees below. */}
            <div className="mt-4 border-t border-neutral-100 pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                Licence / activity price published by the authority
              </p>
              {prices.length > 0 ? (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {prices.map(p => (
                    <li key={p.id}>
                      <span className="font-semibold text-neutral-900">
                        {p.currency}{" "}
                        {p.amount !== null
                          ? Number(p.amount).toLocaleString()
                          : "amount not stated"}
                      </span>{" "}
                      <span className="text-xs text-neutral-500">
                        — source-published licence price
                        {p.conditions ? ` · ${p.conditions}` : ""}. This is the
                        jurisdiction&apos;s listed price; it is{" "}
                        <strong>not</strong> a government approval fee.
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-neutral-500">
                  No licence price is published in the indexed official source.
                </p>
              )}
            </div>
          </Section>

          {/* ── 3. JURISDICTION ───────────────────────────────────────── */}
          <Section number={3} title="Jurisdiction">
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Authority">
                <Link
                  href={`/jurisdictions/${j.slug}`}
                  className="font-medium text-blue-700 hover:underline"
                >
                  {j.name}
                </Link>
              </Field>
              <Field label="Emirate">{formatEmirate(j.emirate)}</Field>
              <Field label="Setup type">{formatJurisdictionType(j.jurisdictionType)}</Field>
              <Field label="Website">
                {j.officialWebsite ? (
                  <a
                    href={j.officialWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-blue-700 hover:underline"
                  >
                    {j.officialWebsite.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  <Muted>Not published</Muted>
                )}
              </Field>
            </dl>
          </Section>

          {/* ── 4. REGULATORY APPROVALS ───────────────────────────────── */}
          <Section number={4} title="Regulatory approvals">
            {signals.length > 0 ? (
              <ul className="space-y-2">
                {signals.map(s => (
                  <li key={s.id} className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-neutral-700">
                    <span className="font-medium text-amber-900">
                      Approval signal from official listing:{" "}
                      {titleCaseEnum(s.signalType)}
                    </span>
                    {s.authorityName && <> — authority indicated: {s.authorityName}</>}
                    {s.notes && (
                      <p className="mt-1 text-xs text-neutral-500">{s.notes}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">
                The official activity listing contains no explicit third-party
                approval indication for this activity.
              </p>
            )}

            {verifiedApprovals.length > 0 ? (
              <ul className="mt-4 space-y-4">
                {verifiedApprovals.map(({ approval: ap, authority, source }) => (
                  <li
                    key={ap.id}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-emerald-900">{ap.name}</p>
                      <VerifiedBadge label="Verified approval" />
                    </div>
                    <p className="mt-1.5 text-emerald-800">
                      Type: {titleCaseEnum(ap.approvalType)} · Requirement
                      status: {titleCaseEnum(ap.status)} · Authority:{" "}
                      {authority?.name ?? "—"} · Last verified:{" "}
                      {ap.lastVerified ? formatDate(ap.lastVerified) : "—"}
                    </p>
                    {ap.description && (
                      <p className="mt-2 leading-relaxed text-emerald-800">{ap.description}</p>
                    )}
                    {ap.applicationProcess && (
                      <p className="mt-2 leading-relaxed text-emerald-800">
                        <span className="font-medium">Application process: </span>
                        {ap.applicationProcess}
                      </p>
                    )}
                    {Array.isArray(ap.requiredDocuments) &&
                      ap.requiredDocuments.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer font-medium text-emerald-800">
                            Required documents ({ap.requiredDocuments.length})
                          </summary>
                          <ul className="mt-1 list-inside list-disc text-emerald-800">
                            {(ap.requiredDocuments as string[]).map((d, i) => (
                              <li key={i}>{String(d)}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    {Array.isArray(ap.conditions) && ap.conditions.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer font-medium text-emerald-800">
                          Conditions ({ap.conditions.length})
                        </summary>
                        <ul className="mt-1 list-inside list-disc text-emerald-800">
                          {(ap.conditions as string[]).map((c, i) => (
                            <li key={i}>{String(c)}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {source && (
                      <p className="mt-2 text-xs text-emerald-700">
                        Official source:{" "}
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all underline"
                        >
                          {source.title || source.url}
                        </a>{" "}
                        (retrieved {source.retrievedDate ? formatDate(source.retrievedDate) : "?"})
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600">
                No VERIFIED regulatory approval records exist for this activity
                yet. Any signal above comes from the jurisdiction&apos;s own
                activity listing and must be confirmed directly with the
                indicated authority before you rely on it.
              </p>
            )}
          </Section>

          {/* ── 5. APPROVAL STATUS ────────────────────────────────────── */}
          <Section number={5} title="Approval status">
            <div className="flex flex-wrap items-center gap-2">
              {hasVerifiedAnything ? (
                <VerifiedBadge label="Verified approval" />
              ) : signals.length > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                  Approval signal
                </span>
              ) : a.approvalSignal === "no_signal" ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  No signal recorded
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Research required
                </span>
              )}
              <span className="text-xs text-neutral-500">
                Activity verification: {titleCaseEnum(a.verificationStatus)}
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-neutral-500">
              Status model: VERIFIED APPROVAL (authoritative source confirms) ·
              APPROVAL SIGNAL (official listing indicates third-party
              involvement; not yet independently verified) · RESEARCH REQUIRED
              (no reliable conclusion yet).
            </p>
          </Section>

          {/* ── 6. GOVERNMENT FEES ────────────────────────────────────── */}
          <Section number={6} title="Government fees">
            {feeRecords.filter(f => f.amount !== null).length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                      <th className="px-4 py-2 font-medium">Fee</th>
                      <th className="px-4 py-2 font-medium">Amount</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="hidden px-4 py-2 font-medium sm:table-cell">Basis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {feeRecords
                      .filter(f => f.amount !== null)
                      .map(f => (
                        <tr key={f.id}>
                          <td className="px-4 py-2.5 text-neutral-700">
                            Government approval fee
                            {f.conditions ? ` — ${f.conditions}` : ""}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-neutral-900">
                            {f.currency} {Number(f.amount).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-neutral-600">{titleCaseEnum(f.feeType)}</td>
                          <td className="hidden px-4 py-2.5 text-neutral-600 sm:table-cell">
                            {titleCaseEnum(f.feeBasis)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-neutral-300 bg-white p-3 text-sm text-neutral-500">
                {FEE_ABSENCE_NOTICE}
              </p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
              Government approval fees are recorded only with their own
              authoritative source. Licence prices shown above are never counted
              here. Unknown fees are displayed as not verified — never as AED 0.
            </p>
          </Section>

          {/* ── 7. THIRD-PARTY COSTS ──────────────────────────────────── */}
          <Section number={7} title="Third-party costs">
            {tpcRecords.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {tpcRecords.map(t => (
                  <li key={t.id}>
                    <span className="font-semibold text-neutral-900">
                      {t.currency}{" "}
                      {t.estimatedAmount !== null
                        ? Number(t.estimatedAmount).toLocaleString()
                        : "varies"}
                    </span>{" "}
                    <span className="text-xs text-neutral-500">
                      ({titleCaseEnum(t.costType)}
                      {t.description ? ` — ${t.description}` : ""})
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md border border-dashed border-neutral-300 bg-white p-3 text-sm text-neutral-500">
                {TPC_ABSENCE_NOTICE}
              </p>
            )}
          </Section>

          {/* ── 8. RESTRICTIONS / REQUIREMENTS ────────────────────────── */}
          <Section number={8} title="Restrictions / requirements">
            {a.restrictions ||
            (Array.isArray((approvalRows[0]?.approval.conditions as unknown)) &&
              (approvalRows[0]?.approval.conditions as string[])?.length > 0) ? (
              <ul className="space-y-2 text-sm">
                {a.restrictions && (
                  <li className="rounded-md border border-red-100 bg-red-50 p-3 text-red-800">
                    Restriction noted by source: {a.restrictions}
                  </li>
                )}
                {verifiedApprovals.flatMap(({ approval: ap }) =>
                  Array.isArray(ap.conditions) && ap.conditions.length > 0
                    ? (ap.conditions as string[]).map((c, i) => (
                        <li
                          key={`${ap.id}-cond-${i}`}
                          className="rounded-md border border-neutral-200 bg-white p-3 text-neutral-700"
                        >
                          {String(c)}
                        </li>
                      ))
                    : []
                )}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">
                No restrictions or additional requirements are published in the
                indexed official sources for this activity.
              </p>
            )}
          </Section>

          {/* ── 9. SOURCE & VERIFICATION ──────────────────────────────── */}
          <Section number={9} title="Source & verification">
            {linkedSources.length > 0 ? (
              <ul className="space-y-4">
                {linkedSources.map(({ source }) => (
                  <li key={source.id} className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <OfficialSourceBadge href={source.url} title={source.title} />
                      <span className="font-medium text-neutral-900">{source.title}</span>
                    </div>
                    <dl className="mt-2 grid gap-x-8 gap-y-1 text-xs sm:grid-cols-2">
                      <div className="flex gap-1">
                        <dt className="text-neutral-400">Authority:</dt>
                        <dd className="text-neutral-700">{source.authority ?? j.name}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="text-neutral-400">Retrieved:</dt>
                        <dd className="text-neutral-700">
                          {source.retrievedDate ? formatDate(source.retrievedDate) : "—"}
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="text-neutral-400">Last verified:</dt>
                        <dd className="text-neutral-700">
                          {source.lastVerified ? formatDate(source.lastVerified) : "not independently verified"}
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="text-neutral-400">URL:</dt>
                        <dd className="min-w-0 break-all">
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-700 hover:underline"
                          >
                            {source.url}
                          </a>
                        </dd>
                      </div>
                    </dl>
                    {typeof source.contentHash === "string" &&
                      source.contentHash.length > 0 && (
                        <p className="mt-2 break-all text-[11px] text-neutral-400">
                          Content hash: {source.contentHash}
                        </p>
                      )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">
                No source record is linked to this activity.
              </p>
            )}
            <p className="mt-3 text-xs text-neutral-400">
              Activity last verified: {a.lastVerified ? formatDate(a.lastVerified) : "never"}.
              Verification information reflects the date the indexed data was
              checked against its official source — always confirm with the
              authority before acting.
            </p>
          </Section>

          {/* ── 10. RELATED ACTIVITIES ────────────────────────────────── */}
          <Section number={10} title="Related activities">
            {relatedActivities.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {relatedActivities.map(r => (
                  <li key={r.id}>
                    <Link
                      href={`/activities/${r.id}`}
                      className="block rounded-lg border border-neutral-200 bg-white px-4 py-3 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
                    >
                      <span className="text-sm font-medium text-neutral-800">
                        {r.officialName}
                      </span>
                      {r.activityCode && (
                        <span className="ml-2 font-mono text-xs text-neutral-400">
                          {r.activityCode}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">
                No related activities were found in {j.name}&apos;s indexed
                dataset for this activity&apos;s group or category.
              </p>
            )}
          </Section>

          {/* ── 11. SIMILAR JURISDICTIONS ─────────────────────────────── */}
          <Section number={11} title="Similar jurisdictions" last>
            <p className="mb-3 text-xs leading-relaxed text-neutral-500">
              Other indexed authorities that publish activities in the same
              group or category. Presence of an activity group does not imply
              identical licensing conditions.
            </p>
            {similarJurisdictions.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {similarJurisdictions.map(sj => (
                  <li key={sj.slug}>
                    <Link
                      href={`/jurisdictions/${sj.slug}`}
                      className="block rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
                    >
                      <span className="text-sm font-semibold text-neutral-900">{sj.name}</span>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {formatEmirate(sj.emirate)} · {formatJurisdictionType(sj.type)}
                      </p>
                      <p className="mt-2 text-xs font-medium text-blue-700">
                        {sj.matches.toLocaleString()}{" "}
                        {sj.matches === 1 ? "activity" : "activities"} in this
                        group/category
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">
                No other indexed jurisdiction publishes activities in this
                group or category yet.
              </p>
            )}
          </Section>
        </div>

        <p className="mb-6 mt-8 text-center text-xs leading-relaxed text-neutral-400">
          Data indexed from official publications. Approval signals are not
          verified approvals. Always verify regulatory requirements with the
          relevant authority before applying.
        </p>
      </div>
    </div>
  );
}

function Section({
  number,
  title,
  children,
  last = false,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section
      aria-labelledby={`sec-${number}`}
      className={`rounded-xl border border-neutral-200 bg-white p-6 ${last ? "" : ""}`}
    >
      <h2
        id={`sec-${number}`}
        className="mb-4 flex items-baseline gap-2.5 text-sm font-bold uppercase tracking-wide text-neutral-500"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-100 text-[10px] tabular-nums text-neutral-500">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-neutral-700">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-neutral-400">{children}</span>;
}
