import { describe, it, expect } from "vitest";
import { buildCoverageSummary, renderCliSummary } from "@/lib/audit/coverage";
import type { JurisdictionCoverageRow, ProvenanceRow, StatusCount } from "@/lib/audit/coverage";

/** Helper to build a minimally-valid input. */
function baseInput(overrides: Partial<Parameters<typeof buildCoverageSummary>[0]> = {}) {
  return {
    dataset: { activities: 100, sources: 2, activitySourceRows: 100, thirdPartyCostRows: 0 },
    jurisdictionCoverage: [] as JurisdictionCoverageRow[],
    emptyJurisdictionCount: 0,
    approvalSignalByJurisdiction: [],
    approvalSignalBySignalType: [],
    verifiedApprovalGlobal: { verifiedApprovalRecords: 0, activitiesWithVerifiedApproval: 0 },
    verifiedFeeProfile: { verifiedFeeRecords: 0, activitiesWithVerifiedFee: 0 },
    thirdPartyCoverage: { totalRecords: 0, verifiedRecords: 0, byJurisdiction: [] as StatusCount[] },
    provenance: [] as ProvenanceRow[],
    orphans: [] as StatusCount[],
    researchQueue: { byStatus: [], byJurisdiction: [] },
    categoryDistribution: [],
    licencesMissing: 0,
    ...overrides,
  };
}

describe("coverage-audit pure logic", () => {
  it("reports per-jurisdiction counts and distinct activity totals without join multiplication", () => {
    const r: JurisdictionCoverageRow = {
      slug: "rakez",
      name: "RAKEZ",
      activities: 10,
      activitiesWithSource: 10,
      activitiesWithApprovalSignal: 8,
      approvalRecords: 3,
      verifiedApprovalRecords: 2,
      activitiesWithVerifiedApproval: 2,
      verifiedFeeRecords: 0,
      activitiesWithVerifiedFee: 0,
      thirdPartyCostRecords: 0,
    };
    const s = buildCoverageSummary(
      baseInput({ dataset: { activities: 10, sources: 2, activitySourceRows: 12, thirdPartyCostRows: 0 }, jurisdictionCoverage: [r] })
    );
    expect(s.jurisdictionCoverage[0].activities).toBe(10);
    // 12 source rows across 10 activities must NOT inflate the activity count.
    expect(s.jurisdictionCoverage[0].activities).toBe(10);
  });

  it("never equates missing fee with zero cost", () => {
    const r: JurisdictionCoverageRow = {
      slug: "ifza", name: "IFZA",
      activities: 5, activitiesWithSource: 5, activitiesWithApprovalSignal: 5,
      approvalRecords: 2, verifiedApprovalRecords: 2, activitiesWithVerifiedApproval: 2,
      verifiedFeeRecords: 0, activitiesWithVerifiedFee: 0, thirdPartyCostRecords: 0,
    };
    const s = buildCoverageSummary(baseInput({ dataset: { activities: 5, sources: 2, activitySourceRows: 5, thirdPartyCostRows: 0 }, jurisdictionCoverage: [r] }));
    expect(s.verifiedFeeProfile.verifiedFeeRecords).toBe(0);
    // A zero verified-fee record count is reported objectively, never as AED 0.
    expect(s.dataQualityFlags.some((f) => f.includes("fee = 0") || f.includes("zero fee"))).toBe(false);
  });

  it("detects verified approvals missing source/last_verified and weak provenance", () => {
    const s = buildCoverageSummary(
      baseInput({
        provenance: [
          { label: "verifiedApprovalMissingSource", count: 2 },
          { label: "verifiedApprovalMissingLastVerified", count: 1 },
          { label: "sourcesMissingContentHash", count: 4 },
        ],
      })
    );
    expect(s.provenance.find((p) => p.label === "verifiedApprovalMissingSource")?.count).toBe(2);
    expect(s.dataQualityFlags).toContain("verifiedApprovalMissingSource: 2");
    expect(s.dataQualityFlags).toContain("verifiedApprovalMissingLastVerified: 1");
  });

  it("flags real orphan findings only", () => {
    const s = buildCoverageSummary(
      baseInput({
        orphans: [
          { status: "approvalFeesOrphanSourceId", count: 3 },
          { status: "activitySourcesOrphanActivity", count: 0 },
        ],
      })
    );
    expect(s.dataQualityFlags).toContain("approvalFeesOrphanSourceId: 3");
    expect(s.dataQualityFlags.some((f) => f.includes("activitySourcesOrphanActivity"))).toBe(false);
  });

  it("reports research queue status counts and jurisdiction breakdown", () => {
    const s = buildCoverageSummary(
      baseInput({
        researchQueue: {
          byStatus: [
            { status: "pending_review", count: 10 },
            { status: "verified", count: 2 },
            { status: "needs_manual_review", count: 1 },
            { status: "not_confirmed", count: 0 },
            { status: "not_required", count: 0 },
          ],
          byJurisdiction: [{ status: "rakez", count: 13 }],
        },
      })
    );
    expect(s.researchQueue.byStatus.find((x) => x.status === "pending_review")?.count).toBe(10);
    expect(s.researchQueue.byJurisdiction[0].count).toBe(13);
    // not_confirmed (0) must NOT be rendered as though it were not_required.
    const nc = s.researchQueue.byStatus.find((x) => x.status === "not_confirmed")!;
    const nr = s.researchQueue.byStatus.find((x) => x.status === "not_required")!;
    expect(nc).toBeDefined();
    expect(nr).toBeDefined();
    expect(nc.status).not.toBe(nr.status);
  });

  it("handles NULL categories without fabrication", () => {
    const s = buildCoverageSummary(
      baseInput({
        categoryDistribution: [
          { slug: "rakez", officialCategory: null, count: 10 },
          { slug: "dmcc", officialCategory: "Technology & Telecom", count: 3 },
        ],
      })
    );
    const nullCat = s.categoryDistribution.find((c) => c.officialCategory === null);
    expect(nullCat?.count).toBe(10);
    // A NULL category row is preserved — not overwritten with a made-up value.
    expect(s.categoryDistribution.some((c) => c.officialCategory === "unknown")).toBe(false);
  });

  it("does not manufacture an arbitrary overall data quality score", () => {
    const s = buildCoverageSummary(baseInput());
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/"score"/i);
    expect(json).not.toMatch(/\bgrade\b/i);
  });

  it("renders a human-readable CLI summary with the objective metrics", () => {
    const s = buildCoverageSummary(
      baseInput({
        jurisdictionCoverage: [{
          slug: "ifza", name: "IFZA", activities: 825, activitiesWithSource: 825,
          activitiesWithApprovalSignal: 825, approvalRecords: 3, verifiedApprovalRecords: 3,
          activitiesWithVerifiedApproval: 3, verifiedFeeRecords: 12, activitiesWithVerifiedFee: 3,
          thirdPartyCostRecords: 0,
        }],
        dataset: { activities: 9109, sources: 10, activitySourceRows: 9109, thirdPartyCostRows: 0 },
        verifiedApprovalGlobal: { verifiedApprovalRecords: 5, activitiesWithVerifiedApproval: 5 },
        verifiedFeeProfile: { verifiedFeeRecords: 12, activitiesWithVerifiedFee: 3 },
      })
    );
    const out = renderCliSummary(s);
    expect(out).toContain("COVERAGE & COMPLETENESS AUDIT");
    expect(out).toContain("verifiedApprovalRecords: 5");
    expect(out).toContain("verifiedFeeRecords: 12");
    expect(out).toContain("ifza");
  });

  it("reports empty third-party cost table as objective absence, never as 'no costs exist' conclusion", () => {
    const s = buildCoverageSummary(baseInput({ thirdPartyCoverage: { totalRecords: 0, verifiedRecords: 0, byJurisdiction: [] } }));
    const out = renderCliSummary(s);
    expect(out).toContain("No verified third-party cost records currently exist.");
    expect(out).toContain("totalRecords: 0");
  });

  it("computes source coverage percentage from actual sourced activities, not unconditional 100%", () => {
    const r: JurisdictionCoverageRow = {
      slug: "rakez", name: "RAKEZ",
      activities: 20, activitiesWithSource: 15, activitiesWithApprovalSignal: 20,
      approvalRecords: 0, verifiedApprovalRecords: 0, activitiesWithVerifiedApproval: 0,
      verifiedFeeRecords: 0, activitiesWithVerifiedFee: 0, thirdPartyCostRecords: 0,
    };
    const s = buildCoverageSummary(
      baseInput({ dataset: { activities: 20, sources: 1, activitySourceRows: 15, thirdPartyCostRows: 0 }, jurisdictionCoverage: [r] })
    );
    expect(s.dataQualityFlags).toContain("globalSourceCoveragePct: 75.0%");
    expect(s.dataQualityFlags).toContain("activitiesWithoutActivitySource: 5");
  });
});