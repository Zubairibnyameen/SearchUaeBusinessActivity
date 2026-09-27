/**
 * Pure decision logic for backfilling approval signals onto already-imported
 * activities (Step 16 DMCC coverage).
 *
 * Rules:
 *  - Authoritative positive evidence (an approving regulator explicitly named
 *    by the official source) → insert/keep a `third_party_approval_required`
 *    signal and set the activity's approval_signal to
 *    `third_party_approval_indicated`.
 *  - Absence of evidence (source column empty) is never converted into a
 *    "no approval required" claim: the activity stays UNKNOWN and any legacy
 *    `no_additional_approval` / `verified` classifications are corrected back
 *    to `unknown` / `unverified`.
 */

import type { ApprovalSignalData, ApprovalSignalValue } from "./types";
import { activities } from "../db/schema";

export type ActivitySignalSnapshot = {
  approvalSignal: ApprovalSignalValue;
  approvalStatus: (typeof activities.$inferSelect)["approvalStatus"];
  verificationStatus: (typeof activities.$inferSelect)["verificationStatus"];
};

const EVIDENCE_SIGNAL_TYPES = new Set(["third_party_approval_required"]);

function hasEvidence(signalDetail: ApprovalSignalData | undefined): boolean {
  return Boolean(
    signalDetail &&
      signalDetail.signalType &&
      EVIDENCE_SIGNAL_TYPES.has(signalDetail.signalType) &&
      signalDetail.authorityName
  );
}

export interface BackfillPlan {
  kind: "insert_signal" | "update_status" | "noop";
  /** Never undefined when kind === "insert_signal". */
  signalDetail?: ApprovalSignalData;
  /** False when the activity's approval_signal is already set (idempotent). */
  needsSignalUpdate?: boolean;
  /** Optional approval/verification status correction (applies either kind). */
  patch?: Partial<ActivitySignalSnapshot>;
}

/**
 * Decide what to do for one existing activity given the normalized incoming
 * signal produced by the adapter.
 */
export function planBackfill(
  current: ActivitySignalSnapshot,
  incoming?: ApprovalSignalData
): BackfillPlan {
  // Any lingering "no_additional_approval"/"verified" claim is never kept:
  // with evidence it is an upgrade, without evidence it is a downgrade of a
  // claim the source never made.
  const statusPatch: Partial<ActivitySignalSnapshot> = {};
  if (current.approvalStatus === "no_additional_approval") {
    statusPatch.approvalStatus = "unknown";
  }
  if (current.verificationStatus === "verified") {
    statusPatch.verificationStatus = "unverified";
  }

  if (hasEvidence(incoming)) {
    return {
      kind: "insert_signal",
      signalDetail: {
        signal: "third_party_approval_indicated",
        signalType: "third_party_approval_required",
        authorityName: incoming!.authorityName,
        notes: incoming!.notes,
      },
      needsSignalUpdate:
        current.approvalSignal !== "third_party_approval_indicated",
      patch: Object.keys(statusPatch).length > 0 ? statusPatch : undefined,
    };
  }

  if (Object.keys(statusPatch).length === 0) return { kind: "noop" };
  return { kind: "update_status", patch: statusPatch };
}

/** True when the same signal (type + authority) already exists for the activity. */
export function hasSameSignal(
  existing: { signalType: string; authorityName: string | null }[],
  signalDetail: ApprovalSignalData | undefined
): boolean {
  if (!signalDetail?.signalType) return false;
  return existing.some(
    (s) =>
      s.signalType === signalDetail.signalType &&
      (s.authorityName ?? "") === (signalDetail.authorityName ?? "")
  );
}