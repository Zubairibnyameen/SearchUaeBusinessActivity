import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  sources,
  activitySources,
  approvals,
  approvalFees,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AdminSourcesPage() {
  const [activityLinkAgg, approvalLinkAgg, feeLinkAgg] = await Promise.all([
    db
      .select({ sourceId: activitySources.sourceId, count: sql<number>`COUNT(*)::int` })
      .from(activitySources)
      .groupBy(activitySources.sourceId),
    db
      .select({ sourceId: approvals.sourceId, count: sql<number>`COUNT(*)::int` })
      .from(approvals)
      .where(sql`${approvals.sourceId} IS NOT NULL`)
      .groupBy(approvals.sourceId),
    db
      .select({ sourceId: approvalFees.sourceId, count: sql<number>`COUNT(*)::int` })
      .from(approvalFees)
      .where(sql`${approvalFees.sourceId} IS NOT NULL`)
      .groupBy(approvalFees.sourceId),
  ]);

  const activityCounts = new Map(activityLinkAgg.map(r => [r.sourceId, r.count]));
  const approvalCounts = new Map(
    approvalLinkAgg.filter(r => r.sourceId).map(r => [r.sourceId!, r.count])
  );
  const feeCounts = new Map(
    feeLinkAgg.filter(r => r.sourceId).map(r => [r.sourceId!, r.count])
  );

  const rows = await db
    .select()
    .from(sources)
    .orderBy(desc(sources.createdAt))
    .limit(200);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Sources</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {rows.length} official source record{rows.length === 1 ? "" : "s"}.
          Every verified claim must link back to one of these.
        </p>
      </header>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Authority</th>
                <th className="px-4 py-2.5 font-medium">Retrieved</th>
                <th className="px-4 py-2.5 font-medium">Last verified</th>
                <th className="px-4 py-2.5 font-medium">Content hash</th>
                <th className="px-4 py-2.5 font-medium text-right">Linked records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map(s => (
                <tr key={s.id}>
                  <td className="max-w-[280px] px-4 py-3">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-700 hover:underline"
                      title={s.url}
                    >
                      {s.title || s.url}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">{s.authority ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                    {s.retrievedDate ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                    {s.lastVerified ?? (
                      <span className="text-amber-600">not independently verified</span>
                    )}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 font-mono text-[11px] text-neutral-400" title={s.contentHash ?? ""}>
                    {s.contentHash ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs tabular-nums text-neutral-600">
                    {activityCounts.get(s.id) ?? 0} act ·{" "}
                    {approvalCounts.get(s.id) ?? 0} appr ·{" "}
                    {feeCounts.get(s.id) ?? 0} fee
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
          No source records yet.
        </div>
      )}
    </div>
  );
}
