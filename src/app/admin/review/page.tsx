import Link from "next/link";
import { requireAdmin } from "@/lib/auth/viewer";
import {
  listReviewItems,
  REVIEW_PAGE_SIZE,
  type ReviewQueueStatus,
} from "@/lib/admin/review-queue";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<ReviewQueueStatus, string> = {
  pending_review: "Pending review",
  verified: "Accepted",
  unverified: "Rejected",
  outdated: "Outdated",
  conflict: "Conflict",
};

const STATUS_STYLES: Record<ReviewQueueStatus, string> = {
  pending_review: "bg-amber-50 text-amber-700",
  verified: "bg-emerald-50 text-emerald-700",
  unverified: "bg-red-50 text-red-700",
  outdated: "bg-neutral-100 text-neutral-600",
  conflict: "bg-orange-50 text-orange-700",
};

const STATUS_VALUES = Object.keys(STATUS_LABELS) as ReviewQueueStatus[];

/**
 * The queue stores a machine reason. Show a reviewer what it means, and keep the
 * raw code next to it so the row can still be traced back to the importer that
 * wrote it.
 */
const REASON_LABELS: Record<string, string> = {
  batch_duplicate_code: "Duplicate activity code in the same upload",
  duplicate_existing: "Already exists in the dataset",
  unknown_activity: "Activity not found",
};

function isReviewStatus(value: string | undefined): value is ReviewQueueStatus {
  return STATUS_VALUES.includes(value as ReviewQueueStatus);
}

function pageHref(page: number, status: string | undefined): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (status) params.set("status", status);
  const qs = params.toString();
  return qs ? `/admin/review?${qs}` : "/admin/review";
}

/**
 * /admin/review — the queue of source rows that were deliberately not imported.
 *
 * Reads are paginated and hard-capped by `REVIEW_PAGE_SIZE`, so this page cannot
 * be made to load an unbounded number of rows. Each item links to its detail
 * page where a reviewer can inspect the preserved source row and decide.
 *
 * No decision is available here: reviewing a row requires reading the raw source
 * payload, which the list deliberately does not carry.
 */
export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const status = isReviewStatus(params.status) ? params.status : undefined;

  const queue = await listReviewItems({ page, pageSize: REVIEW_PAGE_SIZE, status });

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Import Review Queue</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {queue.pendingCount.toLocaleString()} item(s) awaiting a human decision,{" "}
          {queue.total.toLocaleString()} matching the current filter. These are
          official-source rows the importer would not write on its own.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href="/admin/review"
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
            status === undefined
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          All
        </Link>
        {STATUS_VALUES.map(s => (
          <Link
            key={s}
            href={pageHref(1, s)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              status === s
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      {queue.items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th scope="col" className="px-4 py-2.5 font-medium">Jurisdiction</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Code</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Activity</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Zone</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Reason</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Source</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {queue.items.map(item => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/review/${item.id}`}
                      className="font-medium text-neutral-900 underline"
                    >
                      {item.jurisdictionName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                    {item.activityCode ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-800">
                    {item.normalizedName ?? (
                      <span className="text-neutral-500">no name captured</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{item.zone ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-700">
                    <span>{REASON_LABELS[item.reason] ?? item.reason}</span>
                    <span className="block font-mono text-xs text-neutral-500">
                      {item.reason}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                        STATUS_STYLES[item.status] ?? "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    {item.discoveryId ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-neutral-600">
                    {item.createdAt.toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
          {status
            ? `No ${STATUS_LABELS[status].toLowerCase()} items in the import review queue.`
            : "The import review queue is empty. Nothing is waiting for a decision."}
        </div>
      )}

      {queue.totalPages > 1 ? (
        <nav className="mt-4 flex items-center gap-3" aria-label="Review queue pages">
          {queue.page > 1 && (
            <Link
              href={pageHref(queue.page - 1, status)}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
            >
              &larr; Previous
            </Link>
          )}
          <span className="text-sm text-neutral-500">
            Page {queue.page} of {queue.totalPages.toLocaleString()}
          </span>
          {queue.page < queue.totalPages && (
            <Link
              href={pageHref(queue.page + 1, status)}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
            >
              Next &rarr;
            </Link>
          )}
        </nav>
      ) : null}

      <p className="mt-4 text-xs leading-relaxed text-neutral-500">
        Accepting a row records a reviewer&apos;s judgement about the source row
        itself. It does not create an activity, an approval, a fee or a verified
        regulatory claim — the importer never invents regulatory data.
      </p>
    </div>
  );
}
