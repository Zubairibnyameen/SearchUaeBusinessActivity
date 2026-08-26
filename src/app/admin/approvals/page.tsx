import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  approvals,
  approvalAuthorities,
  activities,
  jurisdictions,
  sources,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function AdminApprovalsPage() {
  const rows = await db
    .select({
      approval: approvals,
      authorityName: approvalAuthorities.name,
      activityName: activities.officialName,
      activityId: activities.id,
      jurisdictionName: jurisdictions.name,
      sourceUrl: sources.url,
    })
    .from(approvals)
    .leftJoin(
      approvalAuthorities,
      eq(approvalAuthorities.id, approvals.approvalAuthorityId)
    )
    .innerJoin(activities, eq(activities.id, approvals.activityId))
    .innerJoin(jurisdictions, eq(jurisdictions.id, activities.jurisdictionId))
    .leftJoin(sources, eq(sources.id, approvals.sourceId))
    .orderBy(desc(approvals.createdAt))
    .limit(200);

  const [verifiedAgg] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(approvals)
    .where(eq(approvals.verificationStatus, "verified"));

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {rows.length} approval record{rows.length === 1 ? "" : "s"} ·{" "}
          {verifiedAgg?.count ?? 0} verified. Records are created only through
          the research workflow with an official source.
        </p>
      </header>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2.5 font-medium">Approval</th>
                <th className="px-4 py-2.5 font-medium">Activity</th>
                <th className="px-4 py-2.5 font-medium">Authority</th>
                <th className="px-4 py-2.5 font-medium">Requirement</th>
                <th className="px-4 py-2.5 font-medium">Verification</th>
                <th className="px-4 py-2.5 font-medium">Last verified</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map(r => (
                <tr key={r.approval.id}>
                  <td className="px-4 py-3 font-medium text-neutral-900">
                    {r.approval.name}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/activities/${r.activityId}`}
                      className="text-blue-700 hover:underline"
                    >
                      {r.activityName}
                    </Link>
                    <span className="block text-xs text-neutral-400">
                      {r.jurisdictionName}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    {r.authorityName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    {r.approval.status.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                        r.approval.verificationStatus === "verified"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {r.approval.verificationStatus}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                    {r.approval.lastVerified ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {r.sourceUrl ? (
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-xs text-sky-700 hover:underline"
                      >
                        link ↗
                      </a>
                    ) : (
                      <span className="text-xs text-red-600">MISSING</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
          No approval records yet. Resolve items in Regulatory Research to
          create verified approvals.
        </div>
      )}
    </div>
  );
}
