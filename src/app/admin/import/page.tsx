import type { Metadata } from "next";
import Link from "next/link";
import { FileUp } from "lucide-react";
import { requireAdmin } from "@/lib/auth/viewer";
import { IMPORTABLE_SOURCES } from "@/lib/ingestion/registry";
import { MAX_UPLOAD_BYTES } from "@/lib/ingestion/upload";
import { listReviewItems } from "@/lib/admin/review-queue";
import { ImportSourceForm } from "@/components/admin/import-source-form";

export const metadata: Metadata = { title: "Import Activities | Admin" };
export const dynamic = "force-dynamic";

/**
 * /admin/import — run the existing ingestion pipeline against an official
 * source file.
 *
 * The page is behind the admin layout's `requireAdmin()` gate and re-checks it
 * here, because a page and its actions are separate entry points.
 *
 * Everything the form offers comes from the ingestion registry, so this page
 * cannot drift from what the CLI can import.
 */
export default async function ImportPage() {
  await requireAdmin();

  const queue = await listReviewItems({ page: 1, pageSize: 5 });

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Import Activities</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Import activity data from an official jurisdiction source file. The file is
          parsed by the jurisdiction&apos;s own adapter and preserved with its SHA-256
          hash before anything is written.
        </p>
      </header>

      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-neutral-900">
          <FileUp className="h-5 w-5" /> Upload Source File
        </h2>
        <ImportSourceForm
          sources={IMPORTABLE_SOURCES.map(s => ({
            slug: s.slug,
            label: s.label,
            authorityName: s.authorityName,
            formats: s.formats,
          }))}
          maxUploadBytes={MAX_UPLOAD_BYTES}
        />
      </div>

      <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-6">
        <h2 className="text-sm font-semibold text-amber-900">
          Imported data is source data, not a verified fact
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
          <li>
            Every imported row is written with{" "}
            <code className="font-mono">pending_review</code> verification status.
            Coming from an official source does not make a row human-verified.
          </li>
          <li>
            <code className="font-mono">last_verified</code> stays empty until a
            reviewer checks the row — the retrieval date is recorded on the source
            artifact instead.
          </li>
          <li>
            Approval signals stay signals. The importer never creates approvals,
            fees or licence requirements, and never fills in a regulatory claim that
            the source did not publish.
          </li>
          <li>
            Rows that are duplicates or fail validation are queued for{" "}
            <Link href="/admin/review" className="font-semibold underline">
              review
            </Link>{" "}
            rather than discarded.
          </li>
        </ul>
      </div>

      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-neutral-900">Review Queue</h2>
        <p className="mt-1 text-sm text-neutral-600">
          {queue.pendingCount.toLocaleString()} item(s) waiting for a human decision.
        </p>
        {queue.items.length > 0 ? (
          <ul className="mt-3 divide-y divide-neutral-100 text-sm">
            {/* `min-w-0 break-words` on the text column, `shrink-0` on the action:
                `normalizedName` is free text up to 1000 characters and activity codes
                can be a single unbreakable token. A flex item is floored at
                min-content, so the row would otherwise widen the card. */}
            {queue.items.map(item => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 break-words text-neutral-700">
                  <span className="font-medium">{item.activityCode ?? "—"}</span>{" "}
                  <span className="text-neutral-500">
                    {item.normalizedName ?? "(no name)"} · {item.reason}
                  </span>
                </span>
                <Link
                  href={`/admin/review/${item.id}`}
                  className="shrink-0 text-sm font-medium text-neutral-900 underline"
                >
                  Review
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
            Nothing is waiting for review.
          </p>
        )}
        <Link
          href="/admin/review"
          className="mt-3 inline-block text-sm font-medium text-neutral-900 underline"
        >
          Open the full review queue
        </Link>
      </div>
    </div>
  );
}