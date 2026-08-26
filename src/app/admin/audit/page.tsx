import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminAuditLogs } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const OUTCOME_STYLES: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700",
  failure: "bg-red-50 text-red-700",
  blocked: "bg-amber-50 text-amber-700",
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const PAGE_SIZE = 50;

  const [countAgg] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(adminAuditLogs);
  const total = countAgg?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const rows = await db
    .select()
    .from(adminAuditLogs)
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Security-relevant administrative events: authentication attempts and
          research-workflow mutations. {total.toLocaleString()} entries.
        </p>
      </header>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-4 py-2.5 font-medium">Event</th>
                <th className="px-4 py-2.5 font-medium">Outcome</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
                <th className="px-4 py-2.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-neutral-600">
                    {r.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-800">
                    {r.event}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                        OUTCOME_STYLES[r.outcome] ?? "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {r.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    {r.ip ?? "—"}
                  </td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-xs text-neutral-500" title={r.details ? JSON.stringify(r.details) : ""}>
                    {r.details ? JSON.stringify(r.details) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
          No audit events recorded yet.
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3">
          {page > 1 && (
            <a
              href={`/admin/audit?page=${page - 1}`}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
            >
              &larr; Previous
            </a>
          )}
          <span className="text-sm text-neutral-500">
            Page {page} / {totalPages.toLocaleString()}
          </span>
          {page < totalPages && (
            <a
              href={`/admin/audit?page=${page + 1}`}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
            >
              Next &rarr;
            </a>
          )}
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-neutral-400">
        Data-quality audits are run via the integrity script
        (<code className="font-mono">npx tsx src/scripts/audit-regulatory.ts</code>)
        and reported separately; this view shows the persistent audit trail.
      </p>
    </div>
  );
}
