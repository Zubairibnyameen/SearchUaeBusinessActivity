import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, jurisdictions, licenceTypes } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [countAgg] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(activities);
  const total = countAgg?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const rows = await db
    .select({
      id: activities.id,
      officialName: activities.officialName,
      activityCode: activities.activityCode,
      approvalSignal: activities.approvalSignal,
      verificationStatus: activities.verificationStatus,
      lastVerified: activities.lastVerified,
      jurisdictionName: jurisdictions.name,
      licenceTypeName: licenceTypes.name,
    })
    .from(activities)
    .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
    .leftJoin(licenceTypes, eq(activities.licenceTypeId, licenceTypes.id))
    .orderBy(asc(jurisdictions.name), asc(activities.officialName))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Activities</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {total.toLocaleString()} indexed activities · page {page} of{" "}
          {totalPages}. Read-only view — records are created via the import
          pipeline with source evidence.
        </p>
      </header>

      {/*
        * A stale or hand-edited `?page=` lands past the last page and returns no
        * rows. Rendering the header over an empty `<tbody>` read as "there are no
        * activities" directly above a pager saying "page 999 of 3", which is
        * worse than useless — an admin would conclude the import had emptied the
        * table. Say what actually happened.
        */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8">
          <p className="text-sm font-semibold text-neutral-900">
            {total === 0
              ? "No activities have been indexed yet."
              : `Nothing on page ${page}.`}
          </p>
          <p className="mt-1.5 text-sm text-neutral-600">
            {total === 0
              ? "Activities are created by the import pipeline. Start with Data Import to load an official source."
              : `${total.toLocaleString()} ${
                  total === 1 ? "activity is" : "activities are"
                } indexed across ${totalPages} ${
                  totalPages === 1 ? "page" : "pages"
                }. This page is past the last one.`}
          </p>
          {total > 0 && page > 1 ? (
            <Link
              href="/admin/activities?page=1"
              className="mt-4 inline-block rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              Go to page 1
            </Link>
          ) : null}
        </div>
      ) : (
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th scope="col" className="px-4 py-2.5 font-medium">Activity</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Jurisdiction</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Licence type</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Signal</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <Link
                    href={`/activities/${r.id}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {r.officialName}
                  </Link>
                  {r.activityCode && (
                    <span className="ml-2 font-mono text-xs text-neutral-500">
                      {r.activityCode}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-700">{r.jurisdictionName}</td>
                <td className="px-4 py-3 text-xs text-neutral-600">
                  {r.licenceTypeName ?? "—"}
                </td>
                <td className="px-4 py-3 text-xs text-neutral-600">
                  {r.approvalSignal.replace(/_/g, " ")}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs">
                  <span
                    className={
                      r.verificationStatus === "verified"
                        ? "text-emerald-700"
                        : "text-neutral-500"
                    }
                  >
                    {r.verificationStatus.replace(/_/g, " ")}
                    {r.lastVerified ? ` · ${r.lastVerified}` : ""}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3">
          {page > 1 && (
            <Link
              href={`/admin/activities?page=${page - 1}`}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
            >
              &larr; Previous
            </Link>
          )}
          <span className="text-sm text-neutral-500">
            Page {page} / {totalPages.toLocaleString()}
          </span>
          {page < totalPages && (
            <Link
              href={`/admin/activities?page=${page + 1}`}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
            >
              Next &rarr;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
