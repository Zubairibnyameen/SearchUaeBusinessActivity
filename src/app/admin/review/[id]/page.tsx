import Link from "next/link";
import { notFound } from "next/navigation";
import { parseUuid } from "@/lib/db/uuid";
import { requireAdmin } from "@/lib/auth/viewer";
import { getReviewItem, type ReviewQueueStatus } from "@/lib/admin/review-queue";
import { ReviewDecisionForm } from "@/components/admin/review-decision-form";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<ReviewQueueStatus, string> = {
  pending_review: "Pending review",
  verified: "Accepted by reviewer",
  unverified: "Rejected by reviewer",
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

/** Mirrors the list page: a plain-English meaning plus the raw stored code. */
const REASON_LABELS: Record<string, string> = {
  batch_duplicate_code: "Duplicate activity code in the same upload",
  duplicate_existing: "Already exists in the dataset",
  unknown_activity: "Activity not found",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-900">{value}</dd>
    </div>
  );
}

/**
 * /admin/review/[id] — inspect one queued source row and record a decision.
 *
 * A malformed id 404s before any query runs, and a well-formed id that does not
 * exist 404s identically: an admin cannot use this page to probe for ids.
 */
export default async function ReviewItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const reviewId = parseUuid(id);
  if (!reviewId) notFound();

  const item = await getReviewItem(reviewId);
  if (!item) notFound();

  const isPending = item.status === "pending_review";

  return (
    <div>
      <nav className="mb-4 text-sm">
        <Link href="/admin/review" className="text-neutral-600 underline">
          &larr; Back to review queue
        </Link>
      </nav>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">
            {item.activityCode ?? "Uncoded source row"}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            {item.jurisdictionName} · queued{" "}
            {item.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC
          </p>
        </div>
        <span
          className={`rounded px-2 py-1 text-xs font-semibold ${
            STATUS_STYLES[item.status] ?? "bg-neutral-100 text-neutral-600"
          }`}
        >
          {STATUS_LABELS[item.status] ?? item.status}
        </span>
      </header>

      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Source row
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Jurisdiction" value={item.jurisdictionName} />
          <Field
            label="Activity code"
            value={
              item.activityCode ? (
                <span className="font-mono text-xs">{item.activityCode}</span>
              ) : (
                <span className="text-neutral-500">not published</span>
              )
            }
          />
          <Field
            label="Normalized name"
            value={item.normalizedName ?? <span className="text-neutral-500">none captured</span>}
          />
          <Field label="Zone" value={item.zone ?? <span className="text-neutral-500">—</span>} />
          <Field
            label="Reason queued"
            value={
              <>
                <span>{REASON_LABELS[item.reason] ?? item.reason}</span>
                <span className="mt-0.5 block font-mono text-xs text-neutral-500">
                  {item.reason}
                </span>
              </>
            }
          />
          <Field
            label="Source discovery"
            value={
              item.discoveryId ? (
                <span className="font-mono text-xs">{item.discoveryId}</span>
              ) : (
                <span className="text-neutral-500">unknown</span>
              )
            }
          />
          {item.reportPath ? <Field label="Raw artifact" value={item.reportPath} /> : null}
          <Field
            label="Resolved at"
            value={
              item.resolvedAt
                ? item.resolvedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC"
                : <span className="text-neutral-500">not resolved</span>
            }
          />
        </dl>
      </div>

      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Preserved source payload
        </h2>
        <p className="mb-3 text-xs text-neutral-500">
          The complete original row, exactly as the source published it. Rendered as
          text, never as HTML.
        </p>
        <pre className="max-h-96 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-800">
          {JSON.stringify(item.raw, null, 2)}
        </pre>
      </div>

      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-neutral-900">Decision</h2>
        {item.resolutionNote ? (
          <p className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
            {item.resolutionNote}
          </p>
        ) : null}

        {isPending ? (
          <>
            <p className="mt-2 mb-4 text-sm text-neutral-600">
              Accepting records that this source row is legitimate. It does not create
              an activity, an approval, a fee or a verified regulatory claim, and it
              does not change any existing activity&apos;s verification status.
              Rejecting requires a reason and is not reversible from here.
            </p>
            <ReviewDecisionForm itemId={item.id} />
          </>
        ) : (
          <p className="mt-2 text-sm text-neutral-600">
            This item has already been reviewed and is read-only.{" "}
            <Link href="/admin/review" className="underline">
              Back to the queue
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}