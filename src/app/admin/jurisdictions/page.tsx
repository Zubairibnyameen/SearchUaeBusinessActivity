import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jurisdictions,
  activities,
  approvals,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function AdminJurisdictionsPage() {
  const rows = await db
    .select({
      jurisdiction: jurisdictions,
      activityCount: sql<number>`COUNT(${activities.id})::int`,
      verifiedApprovals: sql<number>`COUNT(DISTINCT CASE WHEN ${approvals.verificationStatus} = 'verified' THEN ${approvals.id} END)::int`,
    })
    .from(jurisdictions)
    .leftJoin(activities, eq(activities.jurisdictionId, jurisdictions.id))
    .leftJoin(approvals, eq(approvals.activityId, activities.id))
    .groupBy(jurisdictions.id)
    .orderBy(jurisdictions.name);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Jurisdictions</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {rows.length} jurisdiction record{rows.length === 1 ? "" : "s"} in the
          registry. New jurisdictions are added only via verified official-data
          imports — never manually.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Emirate</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Type</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-4 py-2.5 font-medium text-right">Activities</th>
              <th scope="col" className="px-4 py-2.5 font-medium text-right">Verified approvals</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Official site</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {/* Empty-state row, so a genuinely unpopulated registry explains
                itself instead of rendering a bare header row. Must live inside
                <tbody> — a <tr> outside it is invalid and is dropped by the
                parser, which would leave the "nothing here" message invisible. */}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-sm text-neutral-600"
                >
                  No jurisdictions have been created yet. They arrive with the
                  first successful import run.
                </td>
              </tr>
            ) : null}
            {rows.map(r => (
              <tr key={r.jurisdiction.id}>
                <td className="px-4 py-3 font-medium text-neutral-900">
                  {r.jurisdiction.name}
                </td>
                <td className="px-4 py-3 text-neutral-700 capitalize">
                  {r.jurisdiction.emirate.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-3 text-xs text-neutral-600">
                  {r.jurisdiction.jurisdictionType.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                      r.jurisdiction.status === "active"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {r.jurisdiction.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.activityCount.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.verifiedApprovals}
                </td>
                <td className="px-4 py-3">
                  {r.jurisdiction.officialWebsite ? (
                    <a
                      href={r.jurisdiction.officialWebsite}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-xs text-sky-700 hover:underline"
                    >
                      link ↗
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* When nothing is indexed, the public-jurisdiction shortcut list renders
          as the bare words "Public pages:" followed by whitespace. */}
      {rows.some(r => r.activityCount > 0) ? (
        <p className="mt-4 text-xs text-neutral-500">
          Public pages:{" "}
          {rows
            .filter(r => r.activityCount > 0)
            .map(r => (
              <Link
                key={r.jurisdiction.slug}
                href={`/jurisdictions/${r.jurisdiction.slug}`}
                className="mr-3 text-blue-700 hover:underline"
              >
                {r.jurisdiction.name}
              </Link>
            ))}
        </p>
      ) : null}
    </div>
  );
}
