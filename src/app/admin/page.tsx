import Link from "next/link";
import { db } from "@/lib/db";
import {
  activities,
  jurisdictions,
  sources,
  approvals,
  approvalFees,
  thirdPartyCosts,
  importReviewQueue,
  regulatoryResearchQueue,
} from "@/lib/db/schema";
import { eq, sql, and, inArray, isNull } from "drizzle-orm";

async function getCounts() {
  const [
    totalActivities,
    totalJurisdictions,
    totalSources,
    signalCounts,
    verifiedApprovals,
    totalFees,
    totalThirdPartyCosts,
    pendingReviewQueue,
    researchByStatus,
    activitiesRequiringResearch,
  ] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(activities),
    db.select({ n: sql<number>`count(*)::int` }).from(jurisdictions),
    db.select({ n: sql<number>`count(*)::int` }).from(sources),
    db
      .select({ signal: activities.approvalSignal, n: sql<number>`count(*)::int` })
      .from(activities)
      .groupBy(activities.approvalSignal),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(approvals)
      .where(eq(approvals.verificationStatus, "verified")),
    db.select({ n: sql<number>`count(*)::int` }).from(approvalFees),
    db.select({ n: sql<number>`count(*)::int` }).from(thirdPartyCosts),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(importReviewQueue)
      .where(eq(importReviewQueue.status, "pending_review")),
    db
      .select({ status: regulatoryResearchQueue.researchStatus, n: sql<number>`count(*)::int` })
      .from(regulatoryResearchQueue)
      .groupBy(regulatoryResearchQueue.researchStatus),
    // Activities needing regulatory research: any non-no_signal state that has
    // no verified approval record yet.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(activities)
      .where(
        and(
          inArray(activities.approvalSignal, ["third_party_approval_indicated", "unknown"]),
          isNull(
            sql`(SELECT 1 FROM approvals ap WHERE ap.activity_id = ${activities.id} AND ap.verification_status = 'verified' LIMIT 1)`
          )
        )
      ),
  ]);

  const signals = Object.fromEntries(signalCounts.map((s) => [s.signal, s.n]));
  const research = Object.fromEntries(researchByStatus.map((r) => [r.status, r.n]));

  return {
    totalActivities: totalActivities[0]?.n ?? 0,
    totalJurisdictions: totalJurisdictions[0]?.n ?? 0,
    totalSources: totalSources[0]?.n ?? 0,
    signals,
    verifiedApprovals: verifiedApprovals[0]?.n ?? 0,
    totalFees: totalFees[0]?.n ?? 0,
    totalThirdPartyCosts: totalThirdPartyCosts[0]?.n ?? 0,
    pendingReviewQueue: pendingReviewQueue[0]?.n ?? 0,
    research,
    activitiesRequiringResearch: activitiesRequiringResearch[0]?.n ?? 0,
  };
}

function StatCard({
  value,
  label,
  href,
  accent,
}: {
  value: number | string;
  label: string;
  href?: string;
  accent?: "amber" | "emerald" | "neutral";
}) {
  const border =
    accent === "amber"
      ? "border-amber-300 bg-amber-50"
      : accent === "emerald"
        ? "border-emerald-300 bg-emerald-50"
        : "border-neutral-200 bg-white";
  const body = (
    <div className={`rounded-lg border p-6 ${border} ${href ? "hover:shadow-sm transition-shadow" : ""}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-neutral-500">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function AdminDashboardPage() {
  const c = await getCounts();
  const tpa = c.signals.third_party_approval_indicated ?? 0;
  const unknown = c.signals.unknown ?? 0;
  const noSignal = c.signals.no_signal ?? 0;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Admin Dashboard</h1>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">
        Dataset
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={c.totalActivities} label="Total activities" />
        <StatCard value={c.totalJurisdictions} label="Jurisdictions" />
        <StatCard value={c.totalSources} label="Official sources" />
        <StatCard
          value={`${tpa} / ${unknown} / ${noSignal}`}
          label="Signals (TPA / unknown / none)"
        />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mt-8 mb-3">
        Regulatory verification
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          value={c.verifiedApprovals}
          label="Verified approvals"
          accent={c.verifiedApprovals > 0 ? "emerald" : "neutral"}
        />
        <StatCard value={c.totalFees} label="Government fees recorded" />
        <StatCard value={c.totalThirdPartyCosts} label="Third-party costs recorded" />
        <StatCard
          value={c.activitiesRequiringResearch}
          label="Activities requiring research"
          accent="amber"
        />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mt-8 mb-3">
        Work queues
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          value={c.research.pending_review ?? 0}
          label="Research queue · pending review"
          href="/admin/research?status=pending_review"
        />
        <StatCard
          value={(c.research.researching ?? 0) + (c.research.conflicting_sources ?? 0) + (c.research.needs_manual_review ?? 0)}
          label="Research queue · in progress/conflicts"
          href="/admin/research"
        />
        <StatCard
          value={c.research.verified ?? 0}
          label="Research queue · verified"
          accent="emerald"
          href="/admin/research?status=verified"
        />
        <StatCard value={c.pendingReviewQueue} label="Import review queue" />
      </div>

      <div className="mt-8 p-6 rounded-lg bg-neutral-50 border border-neutral-200 text-sm text-neutral-600 space-y-1">
        <p className="font-medium text-neutral-700">Data rules enforced</p>
        <p>Approval signals are never promoted to verified approvals without an authoritative source.</p>
        <p>Licence prices, government fees and third-party costs are tracked separately and never merged.</p>
        <p>An absent fee means &ldquo;not yet verified/published in indexed official sources&rdquo; — never AED 0.</p>
      </div>
    </div>
  );
}
