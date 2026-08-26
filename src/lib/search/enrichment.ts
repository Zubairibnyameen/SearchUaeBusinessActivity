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
  }[];
  thirdPartyCosts: {
    estimatedAmount: string | number | null;
    currency: string;
    costType: string;
  }[];
}

const EMPTY: RegulatorySummary = {
  verifiedApprovals: [],
  govFees: [],
  thirdPartyCosts: [],
};

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

  for (const id of activityIds) map.set(id, { ...EMPTY });

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
      });
    }
    for (const t of costs) {
      map.get(approvalToActivity.get(t.approvalId)!)?.thirdPartyCosts.push({
        estimatedAmount: t.estimatedAmount,
        currency: t.currency,
        costType: t.costType,
      });
    }
  }

  return map;
}

/** Attach summaries onto a unified search response's results. */
export async function enrichResponse(
  data: UnifiedSearchResponse
): Promise<Map<string, RegulatorySummary>> {
  const ids = [...new Set(data.results.map(r => r.activity.id))];
  return getRegulatorySummaries(ids);
}
