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
import { getUserStats, requireAdmin } from "@/lib/auth/viewer";
import { SearchInsightsPanel } from "@/components/admin/search-insights-panel";

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
  // Defence in depth, matching every other admin route. The admin layout is
  // already the single authorization gate for this tree, but a layout only runs
  // on render; this page reads `search_usage` aggregates and dataset counts, and
  // `getSearchInsights()` documents that its caller must have run `requireAdmin()`
  // rather than re-deriving it. Calling it here makes that precondition true
  // instead of merely implied, so adding a new data read below cannot silently
  // rely on the layout alone.
  await requireAdmin();

  // Dataset counts are cheap and always available; the SaaS user stats depend on
  // `app_users`, which may not exist on a deployment that has not run the auth
  // migration yet. Degrade to a notice rather than 500-ing the whole dashboard.
  const [c, userStatsResult] = await Promise.all([
    getCounts(),
    getUserStats().then(
      stats => ({ stats, error: null as string | null }),
      () => ({ stats: null, error: "User statistics are unavailable." })
    ),
  ]);
  const userStats = userStatsResult.stats;
  const tpa = c.signals.third_party_approval_indicated ?? 0;
  const unknown = c.signals.unknown ?? 0;
  const noSignal = c.signals.no_signal ?? 0;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Admin Dashboard</h1>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-3">
        Users
      </h2>
      {userStats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            value={userStats.total}
            label="Total users"
            href="/admin/users"
          />
          <StatCard
            value={userStats.active}
            label="Active users"
            accent="emerald"
            href="/admin/users?status=active"
          />
          <StatCard
            value={userStats.suspended}
            label="Suspended users"
            accent={userStats.suspended > 0 ? "amber" : "neutral"}
            href="/admin/users?status=suspended"
          />
          <StatCard
            value={userStats.admins}
            label="Administrators"
            href="/admin/users?role=admin"
          />
          <StatCard
            value={userStats.newLast7Days}
            label="New users · 7 days"
            href="/admin/users"
          />
          <StatCard value={userStats.newLast30Days} label="New users · 30 days" />
          <StatCard value={userStats.signInsLast7Days} label="Sign-ins · 7 days" />
        </div>
      ) : (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {userStatsResult.error}
        </p>
      )}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mt-8 mb-3">
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

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mt-8 mb-3">
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

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mt-8 mb-3">
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
        <StatCard
          value={c.pendingReviewQueue}
          label="Import review queue"
          href="/admin/review?status=pending_review"
          accent={c.pendingReviewQueue > 0 ? "amber" : "neutral"}
        />
      </div>

      <SearchInsightsPanel />

      <div className="mt-8 p-6 rounded-lg bg-neutral-50 border border-neutral-200 text-sm text-neutral-600 space-y-1">
        <p className="font-medium text-neutral-700">Data rules enforced</p>
        <p>Approval signals are never promoted to verified approvals without an authoritative source.</p>
        <p>Licence prices, government fees and third-party costs are tracked separately and never merged.</p>
        <p>An absent fee means &ldquo;not yet verified/published in indexed official sources&rdquo; — never AED 0.</p>
      </div>
    </div>
  );
}
