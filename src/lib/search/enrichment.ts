import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  approvals,
  approvalAuthorities,
  approvalFees,
  thirdPartyCosts,
} from "@/lib/db/schema/approvals";
import type { UnifiedSearchResponse } from "@/lib/search/types";

/**
 * Regulatory summary attached to each search/comparison row.
 * Fees and costs come ONLY from their own strictly-verified tables —
 * never derived from licence/activity prices.
 */
export interface RegulatorySummary {
  verifiedApprovals: {
    name: string;
    authorityName: string | null;
    lastVerified: string | null;
  }[];
  govFees: {
    amount: string | number;
    currency: string;
    feeType: string;
    feeBasis: string | null;
    sourceId: string | null;
  }[];
  thirdPartyCosts: {
    estimatedAmount: string | number | null;
    currency: string;
    costType: string;
    sourceId: string | null;
  }[];
}

const regulatorySummaryEmpty = (): RegulatorySummary => ({
  verifiedApprovals: [],
  govFees: [],
  thirdPartyCosts: [],
});

/**
 * Verified-only regulatory summaries for the given activity ids.
 *
 * Batched: one query for approvals, then at most two more for the fees and
 * third-party costs of the approvals that came back `verified`. Never a
 * per-activity query.
 *
 * The returned map has an entry for EVERY requested id. Presence therefore means
 * "these tables were searched for this activity", and an entry with empty arrays
 * means "nothing verified is published" — which is a finding, not a gap.
 * An id that is absent was never requested.
 */
export async function getRegulatorySummaries(
  activityIds: string[]
): Promise<Map<string, RegulatorySummary>> {
  const map = new Map<string, RegulatorySummary>();
  if (activityIds.length === 0) return map;

  const approvalRows = await db
    .select({
      id: approvals.id,
      activityId: approvals.activityId,
      name: approvals.name,
      verificationStatus: approvals.verificationStatus,
      authorityName: approvalAuthorities.name,
      lastVerified: approvals.lastVerified,
    })
    .from(approvals)
    .leftJoin(
      approvalAuthorities,
      eq(approvalAuthorities.id, approvals.approvalAuthorityId)
    )
    .where(inArray(approvals.activityId, activityIds));

  for (const id of activityIds)
    map.set(id, regulatorySummaryEmpty());

  const verified = approvalRows.filter(r => r.verificationStatus === "verified");
  for (const r of verified) {
    map.get(r.activityId)?.verifiedApprovals.push({
      name: r.name,
      authorityName: r.authorityName ?? null,
      lastVerified: r.lastVerified ?? null,
    });
  }

  const approvalIds = verified.map(r => r.id);
  if (approvalIds.length > 0) {
    const [fees, costs] = await Promise.all([
      db.select().from(approvalFees).where(inArray(approvalFees.approvalId, approvalIds)),
      db.select().from(thirdPartyCosts).where(inArray(thirdPartyCosts.approvalId, approvalIds)),
    ]);

    const approvalToActivity = new Map(
      verified.map(r => [r.id, r.activityId] as const)
    );

    for (const f of fees) {
      if (f.amount === null) continue;
      map.get(approvalToActivity.get(f.approvalId)!)?.govFees.push({
        amount: f.amount,
        currency: f.currency,
        feeType: f.feeType,
        feeBasis: f.feeBasis ?? null,
        sourceId: f.sourceId ?? null,
      });
    }
    for (const t of costs) {
      map.get(approvalToActivity.get(t.approvalId)!)?.thirdPartyCosts.push({
        estimatedAmount: t.estimatedAmount,
        currency: t.currency,
        costType: t.costType,
        sourceId: t.sourceId ?? null,
      });
    }
  }

  return map;
}

/**
 * Which view of a response a caller renders. Decides which activities must be
 * enriched — get this wrong and a rendered card falls back to "no data", which
 * is indistinguishable from "nothing is verified".
 *
 *  - "flat"    — the caller draws from `results` only (a plain list/API consumer).
 *  - "grouped" — the caller draws from `jurisdictionGroups[].topResults` only
 *                (jurisdiction comparison, jurisdiction intelligence). Narrower
 *                than the flat page, so it must not drag in the whole page.
 *  - "all"     — the caller may draw from either, or the caller cannot say. The
 *                union of both; the safe default. Costs nothing extra in queries
 *                because ids are deduplicated and fetched in one batch.
 */
export type RenderedScope = "flat" | "grouped" | "all";

/**
 * The activity ids a response actually renders, for the given scope.
 *
 * Order is deterministic: flat page first, then group order. Duplicates (the two
 * views overlap by design) collapse to their first occurrence.
 */
export function collectRenderedActivityIds(
  response: Pick<UnifiedSearchResponse, "results" | "jurisdictionGroups">,
  scope: RenderedScope = "all"
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  if (scope !== "grouped") {
    for (const item of response.results) add(item.activity.id);
  }
  if (scope !== "flat") {
    for (const group of response.jurisdictionGroups) {
      for (const item of group.topResults) add(item.activity.id);
    }
  }

  return ids;
}

/**
 * Attach summaries onto a unified search response.
 *
 * Every rendered activity gets an entry — `getRegulatorySummaries` pre-seeds an
 * empty summary per requested id — so a lookup miss on a rendered card is a
 * wiring bug, never a silent regulatory claim. A summary that IS present but
 * empty means the verified tables were searched and held nothing for that
 * activity, which is a real, reportable finding.
 */
export async function enrichResponse(
  data: UnifiedSearchResponse
): Promise<Map<string, RegulatorySummary>> {
  return getRegulatorySummaries(collectRenderedActivityIds(data));
}
