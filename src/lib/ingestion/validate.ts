/**
 * Validation for normalized activities.
 * Default rules apply to every jurisdiction; adapters may extend.
 */

import { normalizeName } from "./normalize";
import type {
  NormalizedActivity,
  ParsedActivity,
  ValidationIssue,
} from "./types";

export function defaultValidate(n: NormalizedActivity): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!n.officialName) {
    issues.push({ severity: "error", field: "officialName", message: "Missing official activity name" });
  }
  if (!n.activityCode) {
    issues.push({ severity: "warning", field: "activityCode", message: "Missing activity code" });
  }
  if (!n.description) {
    issues.push({
      severity: "warning",
      field: "description",
      message: "Missing description",
    });
  }
  if (!n.licenceLabel) {
    issues.push({
      severity: "review",
      field: "licenceLabel",
      message: "No licence classification provided by source",
    });
  }
  if (n.approvalSignal === "unknown") {
    issues.push({
      severity: "review",
      field: "approvalSignal",
      message: "Approval signal not determinable from source",
    });
  }
  if (n.officialName && n.normalizedName !== normalizeName(n.officialName)) {
    issues.push({
      severity: "error",
      field: "normalizedName",
      message: "normalizedName does not match canonical derivation of officialName",
    });
  }
  return issues;
}

/**
 * Within-batch duplicate detection.
 * - identical activity_code → true duplicate (keep first)
 * - same normalized_name with different/missing codes → keep both, flag review
 */
export interface BatchDupes {
  duplicateCodeIndexes: number[];
  reviewNameCollisions: Array<{ indexA: number; indexB: number; name: string }>;
}

export function detectBatchDuplicates(rows: NormalizedActivity[]): BatchDupes {
  const byCode = new Map<string, number>();
  const byName = new Map<string, number[]>();
  const dupCodes: number[] = [];
  const collisions: BatchDupes["reviewNameCollisions"] = [];

  rows.forEach((r, i) => {
    if (r.activityCode) {
      // Same code in a different zone is a distinct catalog entry
      // (e.g. RAKEZ Freezone vs Non-Freezone), not a duplicate.
      const key = `${r.activityCode}|${r.zone ?? ""}`;
      const prev = byCode.get(key);
      if (prev !== undefined) {
        dupCodes.push(i);
      } else {
        byCode.set(key, i);
      }
    }
    if (r.normalizedName) {
      const arr = byName.get(r.normalizedName) ?? [];
      arr.push(i);
      byName.set(r.normalizedName, arr);
    }
  });

  for (const [, idxs] of byName) {
    if (idxs.length > 1 && !dupCodes.includes(idxs[1])) {
      // Only flag when codes differ or are absent (pure code-dupes already counted).
      const first = rows[idxs[0]];
      for (let k = 1; k < idxs.length; k++) {
        const other = rows[idxs[k]];
        if (
          first.activityCode &&
          other.activityCode &&
          first.activityCode === other.activityCode
        ) {
          continue;
        }
        collisions.push({ indexA: idxs[0], indexB: idxs[k], name: first.normalizedName });
      }
    }
  }

  return { duplicateCodeIndexes: dupCodes, reviewNameCollisions: collisions };
}
