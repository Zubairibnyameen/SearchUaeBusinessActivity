/**
 * Data-completeness & coverage report logic (STEP 15).
 *
 * PURE functions: every builder here takes already-aggregated SQL result rows
 * and returns a machine-readable report. No DB access, so it is unit-testable
 * in isolation. The read-only queries themselves live in src/scripts/audit-regulatory.ts.
 *
 * Semantics notes (never conflated):
 *  - no_signal / not_confirmed / unknown === absence of evidence, NOT clearance.
 *  - "verified" government fee = an approval_fee row bearing its own last_verified.
 *    Missing fee is never treated as AED 0.
 *  - approvals.verification_status='verified' is distinct from research_status='verified'.
 */

export interface JurisdictionCoverageRow {
  slug: string;
  name: string;
  activities: number;
  activitiesWithSource: number;
  activitiesWithApprovalSignal: number;
  approvalRecords: number;
  verifiedApprovalRecords: number;
  activitiesWithVerifiedApproval: number;
  verifiedFeeRecords: number;
  activitiesWithVerifiedFee: number;
  thirdPartyCostRecords: number;
}

export interface ApprovalSignalByJurisdiction {
  slug: string;
  approvalSignal: string;
  count: number;
}

export interface SignalTypeCount {
  signalType: string;
  count: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface VerifiedFeeProfile {
  verifiedFeeRecords: number;
  activitiesWithVerifiedFee: number;
}

export interface ProvenanceRow {
  label: string;
  count: number;
}

export interface CategoryRow {
  slug: string;
  officialCategory: string | null;
  count: number;
}

export interface CoverageSummary {
  generatedAt: string;
  dataset: Record<string, number>;
  jurisdictionCoverage: JurisdictionCoverageRow[];
  emptyJurisdictionCount: number;
  approvalSignalByJurisdiction: ApprovalSignalByJurisdiction[];
  approvalSignalBySignalType: SignalTypeCount[];
  verifiedApprovalGlobal: { verifiedApprovalRecords: number; activitiesWithVerifiedApproval: number };
  verifiedFeeProfile: VerifiedFeeProfile;
  thirdPartyCoverage: { totalRecords: number; verifiedRecords: number; byJurisdiction: StatusCount[] };
  provenance: ProvenanceRow[];
  orphans: StatusCount[];
  researchQueue: { byStatus: StatusCount[]; byJurisdiction: StatusCount[] };
  categoryDistribution: CategoryRow[];
  licencesMissing: number;
  dataQualityFlags: string[];
}

const PCT = (part: number, whole: number): string | null =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : null;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumDistinctWeights(rows: JurisdictionCoverageRow[], pick: (r: JurisdictionCoverageRow) => number): number {
  return rows.reduce((a, r) => a + pick(r), 0);
}

/**
 * Build the objective coverage summary from the aggregated SQL outputs.
 */
export function buildCoverageSummary(input: {
  generatedAt?: string;
  dataset: Record<string, number>;
  jurisdictionCoverage: JurisdictionCoverageRow[];
  emptyJurisdictionCount?: number;
  approvalSignalByJurisdiction: ApprovalSignalByJurisdiction[];
  approvalSignalBySignalType: SignalTypeCount[];
  verifiedApprovalGlobal: { verifiedApprovalRecords: number; activitiesWithVerifiedApproval: number };
  verifiedFeeProfile: VerifiedFeeProfile;
  thirdPartyCoverage: { totalRecords: number; verifiedRecords: number; byJurisdiction: StatusCount[] };
  provenance: ProvenanceRow[];
  orphans: StatusCount[];
  researchQueue: { byStatus: StatusCount[]; byJurisdiction: StatusCount[] };
  categoryDistribution: CategoryRow[];
  licencesMissing: number;
}): CoverageSummary {
  const summary: CoverageSummary = {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    dataset: { ...input.dataset },
    jurisdictionCoverage: [...input.jurisdictionCoverage],
    emptyJurisdictionCount: input.emptyJurisdictionCount ?? 0,
    approvalSignalByJurisdiction: [...input.approvalSignalByJurisdiction],
    approvalSignalBySignalType: [...input.approvalSignalBySignalType],
    verifiedApprovalGlobal: { ...input.verifiedApprovalGlobal },
    verifiedFeeProfile: { ...input.verifiedFeeProfile },
    thirdPartyCoverage: {
      ...input.thirdPartyCoverage,
      byJurisdiction: [...input.thirdPartyCoverage.byJurisdiction],
    },
    provenance: [...input.provenance],
    orphans: [...input.orphans],
    researchQueue: {
      byStatus: [...input.researchQueue.byStatus],
      byJurisdiction: [...input.researchQueue.byJurisdiction],
    },
    categoryDistribution: [...input.categoryDistribution],
    licencesMissing: input.licencesMissing,
    dataQualityFlags: [],
  };

  const flags = summary.dataQualityFlags;
  const activityCount = input.dataset.activities ?? 0;

  // Verified approvals with weak provenance.
  for (const p of input.provenance) {
    if (
      p.label === "verifiedApprovalMissingSource" ||
      p.label === "verifiedApprovalMissingLastVerified" ||
      p.label === "verifiedApprovalSourceMissingContentHash"
    ) {
      if (p.count > 0) flags.push(`${p.label}: ${p.count}`);
    }
  }

  // Verified fee profile is objective; never infer zero cost.
  if (input.verifiedFeeProfile.verifiedFeeRecords > 0) {
    const jWithFee = input.jurisdictionCoverage.filter((r) => r.verifiedFeeRecords > 0).length;
    flags.push(`verifiedFeeRecords: ${input.verifiedFeeProfile.verifiedFeeRecords}`);
    flags.push(`jurisdictionsWithVerifiedFee: ${jWithFee}`);
  }

  // Orphan/consistency findings (only actual rows).
  for (const o of input.orphans) {
    if (o.count > 0) flags.push(`${o.status}: ${o.count}`);
  }

  // Activities without any activity source (only if the denominator is meaningful).
  const withSource = sumDistinctWeights(
    input.jurisdictionCoverage.filter((r) => r.activities > 0).filter((r) => r.activitiesWithSource > 0),
    (r) => r.activitiesWithSource
  );
  const scopedActivities = sumDistinctWeights(input.jurisdictionCoverage, (r) => r.activities);
  if (activityCount > 0 && scopedActivities > 0) {
    const noSource = scopedActivities - withSource;
    if (noSource > 0) flags.push(`activitiesWithoutActivitySource: ${noSource}`);
  }

  // Approval signal absent on activities (no_signal/unknown indicate absence of signal, not clearance).
  const signalled = sumDistinctWeights(input.jurisdictionCoverage, (r) => r.activitiesWithApprovalSignal);
  if (scopedActivities > 0 && signalled < scopedActivities) {
    flags.push(`activitiesWithoutApprovalSignalRecord: ${scopedActivities - signalled}`);
  }

  // Licence type missing.
  if (input.licencesMissing > 0) flags.push(`activitiesWithLicenceTypeMissing: ${input.licencesMissing}`);

  // Source records lacking content hash (provenance weak — flagged, not auto-modified).
  const sourcesNoHash = input.provenance.find((p) => p.label === "sourcesMissingContentHash");
  if (sourcesNoHash && sourcesNoHash.count > 0) flags.push(`sourcesMissingContentHash: ${sourcesNoHash.count}`);

  // Denominator-aware percentages (only when denominator is non-zero and meaningful).
  // Source coverage = distinct activities with an activity_source / total activities,
  // computed from the per-jurisdiction rows (disjoint, so summing is valid).
  if (activityCount > 0) {
    flags.push(`totalActivities: ${activityCount}`);
    const scoped = sumDistinctWeights(input.jurisdictionCoverage, (r) => r.activities);
    const withSrc = sumDistinctWeights(
      input.jurisdictionCoverage.filter((r) => r.activitiesWithSource > 0),
      (r) => r.activitiesWithSource
    );
    if (scoped > 0) {
      const srcPct = PCT(withSrc, scoped);
      if (srcPct) flags.push(`globalSourceCoveragePct: ${srcPct}`);
    }
  }

  summary.dataQualityFlags = Array.from(new Set(flags));
  return summary;
}

/**
 * Human-readable CLI summary of the coverage report.
 */
export function renderCliSummary(s: CoverageSummary): string {
  const lines: string[] = [];
  lines.push("=== COVERAGE & COMPLETENESS AUDIT ===");
  lines.push(`generatedAt: ${s.generatedAt}`);
  lines.push("--- Dataset totals ---");
  for (const [k, v] of Object.entries(s.dataset)) lines.push(`  ${k}: ${v}`);
  lines.push(`  emptyJurisdictionRows: ${s.emptyJurisdictionCount}`);

  lines.push("--- Jurisdiction coverage ---");
  const total = s.dataset.activities ?? 0;
  for (const r of s.jurisdictionCoverage) {
    const pct = total > 0 ? ((r.activities / total) * 100).toFixed(1) : "0.0";
    lines.push(
      `  ${r.slug} (${r.name}): activities=${r.activities} (${pct}% of total)` +
        ` sources=${r.activitiesWithSource} signals=${r.activitiesWithApprovalSignal}` +
        ` verifiedApprovals=${r.verifiedApprovalRecords} activitiesWithVerifiedApproval=${r.activitiesWithVerifiedApproval}` +
        ` verifiedFees=${r.verifiedFeeRecords} thirdPartyCosts=${r.thirdPartyCostRecords}`
    );
  }

  lines.push("--- Approval signal coverage ---");
  for (const r of s.approvalSignalBySignalType) lines.push(`  signalType ${r.signalType}: ${r.count}`);
  lines.push("  by activity.approval_signal (per jurisdiction):");
  const bySig: Record<string, Record<string, number>> = {};
  for (const r of s.approvalSignalByJurisdiction) {
    bySig[r.approvalSignal] ??= {};
    bySig[r.approvalSignal][r.slug] = r.count;
  }
  for (const [sig, m] of Object.entries(bySig)) {
    lines.push(`    ${sig}: ${Object.entries(m).map(([slug, c]) => `${slug}=${c}`).join(", ")}`);
  }

  lines.push("--- Verified approval coverage ---");
  lines.push(`  verifiedApprovalRecords: ${s.verifiedApprovalGlobal.verifiedApprovalRecords}`);
  lines.push(`  activitiesWithVerifiedApproval: ${s.verifiedApprovalGlobal.activitiesWithVerifiedApproval}`);

  lines.push("--- Government fee coverage ---");
  lines.push(`  verifiedFeeRecords: ${s.verifiedFeeProfile.verifiedFeeRecords}`);
  lines.push(`  activitiesWithVerifiedFee: ${s.verifiedFeeProfile.activitiesWithVerifiedFee}`);

  lines.push("--- Third-party cost coverage ---");
  lines.push(`  totalRecords: ${s.thirdPartyCoverage.totalRecords}`);
  lines.push(`  verifiedRecords: ${s.thirdPartyCoverage.verifiedRecords}`);
  for (const r of s.thirdPartyCoverage.byJurisdiction) lines.push(`    ${r.status}: ${r.count}`);

  lines.push("--- Provenance ---");
  for (const p of s.provenance) lines.push(`  ${p.label}: ${p.count}`);

  lines.push("--- Orphan / integrity ---");
  if (s.orphans.length === 0) lines.push("  (none)");
  for (const o of s.orphans) lines.push(`  ${o.status}: ${o.count}`);

  lines.push("--- Research queue ---");
  for (const r of s.researchQueue.byStatus) lines.push(`  ${r.status}: ${r.count}`);
  if (s.researchQueue.byJurisdiction.length > 0) {
    lines.push("  by jurisdiction:");
    for (const r of s.researchQueue.byJurisdiction) lines.push(`    ${r.status}: ${r.count}`);
  }

  if (s.thirdPartyCoverage.totalRecords === 0) {
    lines.push("\nNo verified third-party cost records currently exist.");
  }

  lines.push("--- Data quality flags ---");
  if (s.dataQualityFlags.length === 0) lines.push("  (none)");
  for (const f of s.dataQualityFlags) lines.push(`  * ${f}`);

  return lines.join("\n");
}
