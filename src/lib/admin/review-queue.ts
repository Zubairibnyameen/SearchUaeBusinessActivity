/**
 * Import review queue — data access.
 *
 * Backs /admin/review. Reads are paginated and bounded; writes are conditional
 * on the row still being pending, so a repeated or concurrent submit cannot
 * silently overwrite a decision someone else already made.
 *
 * WHAT A DECISION DOES — AND DOES NOT — MEAN
 *
 * The queue holds source rows that were deliberately NOT imported into
 * `activities` (a duplicate code inside the batch, a row that already exists in
 * the database). Approving one records a reviewer's judgement about the *source
 * row*; it does not create an activity, an approval, a fee, a licence
 * requirement, or a verified regulatory claim. Nothing in this module writes to
 * `activities`, `approvals`, `approval_fees` or `third_party_costs`, and no path
 * here can be used to change a role or a user's status.
 *
 * The caller must have run `requireAdmin()` already; like `admin-users.ts`, this
 * module re-derives nothing. The acting admin is passed in for the audit trail
 * only.
 */

import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { importReviewQueue, jurisdictions } from "@/lib/db/schema";
import { verificationStatusEnum } from "@/lib/db/schema/activities";

/** Mirrors `verification_status`, which the queue reuses as its outcome column. */
export type ReviewQueueStatus =
  (typeof verificationStatusEnum.enumValues)[number];

export const REVIEW_PAGE_SIZE = 25;
/** Hard ceiling so a crafted `?pageSize=` can never ask for the whole table. */
export const REVIEW_MAX_PAGE_SIZE = 100;

/** Outcomes a reviewer may record. Anything else is rejected server-side. */
export const REVIEW_DECISIONS = ["approve", "reject", "pending"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * Outcome per decision. `pending` deliberately maps to `pending_review` — the
 * "leave it for someone else" action must not resolve the row.
 */
const STATUS_FOR_DECISION: Record<ReviewDecision, ReviewQueueStatus> = {
  approve: "verified",
  reject: "unverified",
  pending: "pending_review",
};

export class ReviewActionError extends Error {
  readonly code: "not_found" | "already_resolved" | "note_required" | "invalid";
  constructor(code: ReviewActionError["code"], message: string) {
    super(message);
    this.name = "ReviewActionError";
    this.code = code;
  }
}

export interface ReviewItemRow {
  id: string;
  jurisdictionName: string;
  jurisdictionSlug: string;
  activityCode: string | null;
  normalizedName: string | null;
  zone: string | null;
  reason: string;
  status: ReviewQueueStatus;
  discoveryId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  hasRaw: boolean;
}

export interface ReviewItemDetail extends ReviewItemRow {
  raw: unknown;
  resolutionNote: string | null;
  reportPath: string | null;
}

export interface ReviewQueuePage {
  items: ReviewItemRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  pendingCount: number;
}

export interface ListReviewItemsOptions {
  page?: number;
  pageSize?: number;
  /** Omit for every status. */
  status?: ReviewQueueStatus;
  jurisdictionSlug?: string;
}

function clampPageSize(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return REVIEW_PAGE_SIZE;
  return Math.min(REVIEW_MAX_PAGE_SIZE, Math.max(1, Math.trunc(value)));
}

const itemColumns = {
  id: importReviewQueue.id,
  jurisdictionName: jurisdictions.name,
  jurisdictionSlug: jurisdictions.slug,
  activityCode: importReviewQueue.activityCode,
  normalizedName: importReviewQueue.normalizedName,
  zone: importReviewQueue.zone,
  reason: importReviewQueue.reason,
  status: importReviewQueue.status,
  discoveryId: importReviewQueue.discoveryId,
  createdAt: importReviewQueue.createdAt,
  resolvedAt: importReviewQueue.resolvedAt,
};

/** `raw` is deliberately excluded from list queries — it can be a whole row. */
export async function listReviewItems(
  options: ListReviewItemsOptions = {}
): Promise<ReviewQueuePage> {
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = clampPageSize(options.pageSize);

  const filters = [
    ...(options.status ? [eq(importReviewQueue.status, options.status)] : []),
    ...(options.jurisdictionSlug
      ? [eq(jurisdictions.slug, options.jurisdictionSlug)]
      : []),
  ];
  const where = filters.length ? and(...filters) : undefined;

  const [totalAgg] = await db
    .select({ n: count() })
    .from(importReviewQueue)
    .innerJoin(jurisdictions, eq(jurisdictions.id, importReviewQueue.jurisdictionId))
    .where(where);
  const [pendingAgg] = await db
    .select({ n: count() })
    .from(importReviewQueue)
    .where(eq(importReviewQueue.status, "pending_review"));

  const rows = await db
    .select({ ...itemColumns, hasRaw: sql<boolean>`(${importReviewQueue.raw}) IS NOT NULL` })
    .from(importReviewQueue)
    .innerJoin(jurisdictions, eq(jurisdictions.id, importReviewQueue.jurisdictionId))
    .where(where)
    .orderBy(desc(importReviewQueue.createdAt), desc(importReviewQueue.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const total = totalAgg?.n ?? 0;
  return {
    items: rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    pendingCount: pendingAgg?.n ?? 0,
  };
}

export async function getReviewItem(
  id: string
): Promise<ReviewItemDetail | null> {
  const [row] = await db
    .select({
      ...itemColumns,
      raw: importReviewQueue.raw,
      resolutionNote: importReviewQueue.resolutionNote,
      reportPath: importReviewQueue.reportPath,
      hasRaw: sql<boolean>`(${importReviewQueue.raw}) IS NOT NULL`,
    })
    .from(importReviewQueue)
    .innerJoin(jurisdictions, eq(jurisdictions.id, importReviewQueue.jurisdictionId))
    .where(eq(importReviewQueue.id, id))
    .limit(1);
  return row ?? null;
}

export interface ResolveReviewInput {
  id: string;
  decision: ReviewDecision;
  note?: string;
}

export interface ResolveReviewResult {
  status: ReviewQueueStatus;
}

/**
 * Record a reviewer's decision.
 *
 * - `approve` / `reject` set `resolved_at`, so the row leaves the pending queue.
 * - `pending` leaves `status` and `resolved_at` untouched: it records a note and
 *   keeps the item in the queue for later.
 * - Every write is conditional on the row STILL being `pending_review` and uses
 *   `.returning()`. A repeat submit, or a second admin racing the first, matches
 *   zero rows and is reported as already resolved rather than double-writing.
 * - A rejection requires a note: "this row is wrong" with no reason is not a
 *   reviewable decision.
 *
 * Nothing here promotes source data to a regulatory fact.
 */
export async function resolveReviewItem(
  input: ResolveReviewInput
): Promise<ResolveReviewResult> {
  const { id, decision } = input;
  const note = input.note?.trim();

  if (!REVIEW_DECISIONS.includes(decision)) {
    throw new ReviewActionError("invalid", "Unknown review action.");
  }
  if (decision === "reject" && !note) {
    throw new ReviewActionError(
      "note_required",
      "Explain why this row is being rejected."
    );
  }

  const status = STATUS_FOR_DECISION[decision];
  const isPendingHold = decision === "pending";

  const updated = await db
    .update(importReviewQueue)
    .set({
      status,
      // Holding an item pending must not stamp it as resolved.
      ...(isPendingHold ? {} : { resolvedAt: new Date() }),
      resolutionNote: note || null,
    })
    .where(
      and(
        eq(importReviewQueue.id, id),
        eq(importReviewQueue.status, "pending_review")
      )
    )
    .returning({ status: importReviewQueue.status });

  if (updated.length === 0) {
    // Either the row does not exist, or it is no longer pending. Distinguishing
    // them would let an admin probe for ids; the caller gets one safe message.
    throw new ReviewActionError(
      "already_resolved",
      "This item has already been reviewed. Reload to see its current state."
    );
  }

  return { status: updated[0]!.status };
}