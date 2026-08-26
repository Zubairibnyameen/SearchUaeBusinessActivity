import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activities,
  jurisdictions,
  approvals,
  approvalFees,
} from "@/lib/db/schema";
import { SearchBar } from "@/components/search/search-bar";
import {
  VerifiedBadge,
  ApprovalSignalBadgeSmall,
  ResearchRequiredBadge,
  OfficialSourceBadge,
} from "@/components/ui/verification-badges";

const EXAMPLE_QUERIES = [
  "Digital Marketing Agency",
  "Restaurant",
  "Medical Clinic",
  "Software Development Company",
  "General Trading",
  "Real Estate Brokerage",
];

export const dynamic = "force-dynamic";

async function getHomeStats() {
  const [activityAgg, jurisdictionCount, verifiedApprovalCount, feeCount] =
    await Promise.all([
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(activities),
      // Count only jurisdictions whose official activity data is imported.
      db
        .selectDistinct({ id: jurisdictions.id })
        .from(jurisdictions)
        .innerJoin(activities, eq(activities.jurisdictionId, jurisdictions.id)),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(approvals)
        .where(eq(approvals.verificationStatus, "verified")),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(approvalFees),
    ]);

  return {
    activities: activityAgg[0]?.count ?? 0,
    jurisdictions: jurisdictionCount.length,
    verifiedApprovals: verifiedApprovalCount[0]?.count ?? 0,
    govFees: feeCount[0]?.count ?? 0,
  };
}

export default async function HomePage() {
  const stats = await getHomeStats();

  return (
    <div className="bg-white">
      {/* ── HERO ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-neutral-200">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(15,23,42,0.05),transparent)]"
        />
        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-16 text-center sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            UAE business &amp; regulatory intelligence
          </span>

          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl">
            Search UAE Business Activities.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-lg text-neutral-600">
            Find jurisdictions, licences, approvals and regulatory costs.
          </p>

          <div className="mt-10">
            <SearchBar />
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            <span className="text-sm text-neutral-400">Try:</span>
            {EXAMPLE_QUERIES.map(q => (
              <Link
                key={q}
                href={`/search?q=${encodeURIComponent(q)}`}
                className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-sm text-neutral-600 shadow-sm transition-colors hover:border-neutral-300 hover:text-neutral-900"
              >
                {q}
              </Link>
            ))}
          </div>

          <dl className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-y-8 sm:grid-cols-4">
            <Stat label="Activities indexed" value={stats.activities.toLocaleString()} />
            <Stat label="Jurisdictions" value={stats.jurisdictions.toLocaleString()} />
            <Stat label="Verified approvals" value={stats.verifiedApprovals.toLocaleString()} />
            <Stat label="Government fees verified" value={stats.govFees.toLocaleString()} />
          </dl>
        </div>
      </section>

      {/* ── TRUST / DATA PROVENANCE ────────────────────────────────────── */}
      <section className="border-b border-neutral-200 bg-neutral-50">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-neutral-500">
            Every claim carries its evidence
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-neutral-600">
            Data is indexed exclusively from official authority publications.
            Certainty levels are shown exactly as verified &mdash; nothing is
            presented as more certain than its source supports.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TrustCard
              badge={<OfficialSourceBadge />}
              title="Official source"
              text="Each record links back to the government publication it was captured from, with retrieval dates."
            />
            <TrustCard
              badge={<VerifiedBadge />}
              title="Verified"
              text="Confirmed against an authoritative source and dated, so you know how fresh the evidence is."
            />
            <TrustCard
              badge={<ApprovalSignalBadgeSmall />}
              title="Approval signal"
              text="The official listing indicates third-party involvement. A signal is explicitly not a verified approval."
            />
            <TrustCard
              badge={<ResearchRequiredBadge />}
              title="Research required"
              text="No reliable conclusion exists yet. We show unknowns honestly instead of guessing."
            />
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────────────────── */}
      <section className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-10 lg:grid-cols-3">
            <FeatureCard
              title="Activity-level search"
              text="Describe your business idea in plain language. Results are matched to official activity names and codes across every indexed jurisdiction, with the reason each result matched shown alongside it."
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              }
            />
            <FeatureCard
              title="Approvals & costs, separated"
              text="Licence prices, government approval fees and third-party costs are tracked as distinct facts with independent sources — never blended into one misleading number."
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              }
            />
            <FeatureCard
              title="Jurisdiction comparison"
              text="See where an activity is offered across free zones and mainland authorities — availability, licence type, approval status and verified fees, side by side in one table."
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              }
            />
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────── */}
      <section className="bg-neutral-900">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-12 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">
              Start with your business idea.
            </h2>
            <p className="mt-1 text-sm text-neutral-300">
              See which UAE authorities offer it &mdash; and what is actually
              verified about approvals and costs.
            </p>
          </div>
          <Link
            href="/jurisdictions"
            className="shrink-0 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-100"
          >
            Browse indexed jurisdictions
          </Link>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
        {value}
      </dd>
      <dt className="mt-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
    </div>
  );
}

function TrustCard({
  badge,
  title,
  text,
}: {
  badge: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="mb-3">{badge}</div>
      <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">{text}</p>
    </div>
  );
}

function FeatureCard({
  title,
  text,
  icon,
}: {
  title: React.ReactNode;
  text: string;
  icon: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-900">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth={1.8}
          className="h-5 w-5"
          aria-hidden
        >
          {icon}
        </svg>
      </div>
      <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600">{text}</p>
    </div>
  );
}
