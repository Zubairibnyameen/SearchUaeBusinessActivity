import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  approvalFees,
  thirdPartyCosts,
  approvals,
} from "@/lib/db/schema/approvals";
import { activities } from "@/lib/db/schema";
import { sources } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function AdminFeesPage() {
  const [feeRows, tpcRows] = await Promise.all([
    db
      .select({
        fee: approvalFees,
        approvalName: approvals.name,
        activityName: activities.officialName,
        activityId: activities.id,
        sourceUrl: sources.url,
      })
      .from(approvalFees)
      .innerJoin(approvals, eq(approvals.id, approvalFees.approvalId))
      .innerJoin(activities, eq(activities.id, approvals.activityId))
      .leftJoin(sources, eq(sources.id, approvalFees.sourceId))
      .orderBy(desc(approvalFees.createdAt))
      .limit(200),
    db
      .select({
        cost: thirdPartyCosts,
        approvalName: approvals.name,
        activityName: activities.officialName,
        activityId: activities.id,
        sourceUrl: sources.url,
      })
      .from(thirdPartyCosts)
      .innerJoin(approvals, eq(approvals.id, thirdPartyCosts.approvalId))
      .innerJoin(activities, eq(activities.id, approvals.activityId))
      .leftJoin(sources, eq(sources.id, thirdPartyCosts.sourceId))
      .orderBy(desc(thirdPartyCosts.createdAt))
      .limit(200),
  ]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Fees</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Government approval fees and third-party costs, kept strictly
          separate. Each row carries its own source.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-neutral-500">
          Government fees ({feeRows.length})
        </h2>
        {feeRows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2.5 font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Type / basis</th>
                  <th className="px-4 py-2.5 font-medium">Approval</th>
                  <th className="px-4 py-2.5 font-medium">Activity</th>
                  <th className="px-4 py-2.5 font-medium">Conditions</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {feeRows.map(r => (
                  <tr key={r.fee.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold">
                      {r.fee.amount !== null
                        ? `${r.fee.currency} ${Number(r.fee.amount).toLocaleString()}`
                        : "not stated"}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-600">
                      {r.fee.feeType.replace(/_/g, " ")} ·{" "}
                      {r.fee.feeBasis.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{r.approvalName}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/activities/${r.activityId}`}
                        className="text-blue-700 hover:underline"
                      >
                        {r.activityName}
                      </Link>
                    </td>
                    <td className="max-w-[220px] px-4 py-3 text-xs text-neutral-500">
                      {r.fee.conditions ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {r.sourceUrl ? (
                        <a
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-sky-700 hover:underline"
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
          <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
            No government fee records yet.
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-neutral-500">
          Third-party costs ({tpcRows.length})
        </h2>
        {tpcRows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2.5 font-medium">Estimate</th>
                  <th className="px-4 py-2.5 font-medium">Cost type</th>
                  <th className="px-4 py-2.5 font-medium">Approval</th>
                  <th className="px-4 py-2.5 font-medium">Activity</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {tpcRows.map(r => (
                  <tr key={r.cost.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold">
                      {r.cost.estimatedAmount !== null
                        ? `${r.cost.currency} ${Number(r.cost.estimatedAmount).toLocaleString()}`
                        : `${r.cost.currency || ""} varies`}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-600">
                      {r.cost.costType.replace(/_/g, " ")}
                      {r.cost.description ? ` — ${r.cost.description}` : ""}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{r.approvalName}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/activities/${r.activityId}`}
                        className="text-blue-700 hover:underline"
                      >
                        {r.activityName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {r.sourceUrl ? (
                        <a
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-sky-700 hover:underline"
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
          <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
            No third-party cost records yet.
          </div>
        )}
      </section>
    </div>
  );
}
