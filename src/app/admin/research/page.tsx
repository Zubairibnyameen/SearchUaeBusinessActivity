import Link from "next/link";
import { db } from "@/lib/db";
import { regulatoryResearchQueue, jurisdictions, activities } from "@/lib/db/schema";
import { eq, desc, sql, and, type SQL } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  pending_review: "Pending review",
  researching: "Researching",
  verified: "Verified",
  not_required: "Not required",
  conflicting_sources: "Conflicting sources",
  needs_manual_review: "Needs manual review",
  not_confirmed: "Not confirmed",
};

const STATUS_STYLES: Record<string, string> = {
  pending_review: "bg-neutral-100 text-neutral-700",
  researching: "bg-blue-50 text-blue-700",
  verified: "bg-emerald-50 text-emerald-700",
  not_required: "bg-emerald-50 text-emerald-700",
  conflicting_sources: "bg-red-50 text-red-700",
  needs_manual_review: "bg-amber-50 text-amber-800",
  not_confirmed: "bg-neutral-200 text-neutral-700",
};

interface ResearchListPageProps {
  searchParams: Promise<{ status?: string; jurisdiction?: string; page?: string }>;
}

const PAGE_SIZE = 25;

export default async function ResearchListPage({ searchParams }: ResearchListPageProps) {
  const sp = await searchParams;
  const statusFilter = sp.status && STATUS_LABELS[sp.status] ? sp.status : undefined;
  const jurisdictionFilter = sp.jurisdiction || undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const conditions: SQL[] = [];
  if (statusFilter) conditions.push(eq(regulatoryResearchQueue.researchStatus, statusFilter as never));
  if (jurisdictionFilter) conditions.push(eq(regulatoryResearchQueue.jurisdictionId, jurisdictionFilter));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRow, jurRows, statusCounts] = await Promise.all([
    db
      .select({
        id: regulatoryResearchQueue.id,
        code: regulatoryResearchQueue.activityCode,
        activityId: regulatoryResearchQueue.activityId,
        officialName: activities.officialName,
        jurisdictionSlug: jurisdictions.slug,
        signal: regulatoryResearchQueue.approvalSignal,
        authority: regulatoryResearchQueue.possibleAuthority,
        status: regulatoryResearchQueue.researchStatus,
        priority: regulatoryResearchQueue.priorityScore,
        updatedAt: regulatoryResearchQueue.lastUpdatedAt,
      })
      .from(regulatoryResearchQueue)
      .innerJoin(activities, eq(activities.id, regulatoryResearchQueue.activityId))
      .innerJoin(jurisdictions, eq(jurisdictions.id, regulatoryResearchQueue.jurisdictionId))
      .where(where)
      .orderBy(desc(regulatoryResearchQueue.priorityScore), desc(regulatoryResearchQueue.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(regulatoryResearchQueue)
      .where(where),
    db.select({ id: jurisdictions.id, slug: jurisdictions.slug }).from(jurisdictions),
    db
      .select({ status: regulatoryResearchQueue.researchStatus, n: sql<number>`count(*)::int` })
      .from(regulatoryResearchQueue)
      .groupBy(regulatoryResearchQueue.researchStatus),
  ]);

  const total = totalRow[0]?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildHref = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { status: statusFilter, jurisdiction: jurisdictionFilter, page: String(page), ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/admin/research?${params.toString()}`;
  };

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Regulatory Research Queue</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Prioritized worklist for verifying approval signals. Signals are never promoted to verified
        approvals without an authoritative source. Unresolved records are kept.
      </p>

      {/* Status summary */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Link
          href={buildHref({ status: undefined, page: undefined })}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border ${!statusFilter ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-600 border-neutral-200"}`}
        >
          All ({Object.values(statusCounts).reduce((a, b) => a + b.n, 0)})
        </Link>
        {statusCounts.map((s) => (
          <Link
            key={s.status}
            href={buildHref({ status: s.status as string, page: undefined })}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${statusFilter === s.status ? "ring-2 ring-neutral-300" : ""} ${STATUS_STYLES[s.status as string] ?? ""}`}
          >
            {STATUS_LABELS[s.status as string] ?? s.status} ({s.n})
          </Link>
        ))}
      </div>

      {/* Jurisdiction filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href={buildHref({ jurisdiction: undefined, page: undefined })}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border ${!jurisdictionFilter ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-600 border-neutral-200"}`}
        >
          All jurisdictions
        </Link>
        {jurRows.map((j) => (
          <Link
            key={j.id}
            href={buildHref({ jurisdiction: j.id, page: undefined })}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border uppercase ${jurisdictionFilter === j.id ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-600 border-neutral-200"}`}
          >
            {j.slug}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-sm text-neutral-500">
          No research items match the current filters.
        </div>
      ) : (
        <div className="border border-neutral-200 rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Activity</th>
                <th className="px-4 py-3 font-medium">Jur.</th>
                <th className="px-4 py-3 font-medium">Possible authority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                  <td className="px-4 py-3 font-mono">{r.priority}</td>
                  <td className="px-4 py-3 max-w-md">
                    <Link href={`/admin/research/${r.id}`} className="font-medium text-neutral-900 hover:underline">
                      {r.officialName}
                    </Link>
                    {r.code && <span className="ml-2 text-xs text-neutral-400">[{r.code}]</span>}
                  </td>
                  <td className="px-4 py-3 uppercase text-neutral-500">{r.jurisdictionSlug}</td>
                  <td className="px-4 py-3 text-neutral-600">{r.authority ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[r.status as string] ?? ""}`}>
                      {STATUS_LABELS[r.status as string] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-400">
                    {new Date(r.updatedAt).toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex gap-3 mt-4 justify-center text-sm">
          {page > 1 && (
            <Link className="text-blue-600 hover:underline" href={buildHref({ page: String(page - 1) })}>
              ← Previous
            </Link>
          )}
          <span className="text-neutral-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link className="text-blue-600 hover:underline" href={buildHref({ page: String(page + 1) })}>
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
