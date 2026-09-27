import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// Public-facing regulatory behavior (STEP 9 §11):
//   O. VERIFIED  -> surfaced as verified public evidence
//   O. PENDING   -> never surfaced as verified
//   O. MANUAL_REVIEW / unverified -> never surfaced as verified
//   P. NOT_CONFIRMED / absence   -> never interpreted as an affirmative
//                                    negative ("no additional approval").
//   M. government fees vs third-party costs stay separate
//   N. only fees belonging to verified approvals are surfaced
// The engine under test is getRegulatorySummaries(), which drives the public
// compare/search "verified approvals" evidence.
// ─────────────────────────────────────────────────────────────────────────

type ApprovalRow = {
  id: string;
  activityId: string;
  name: string;
  verificationStatus: string;
  authorityName: string | null;
  lastVerified: string | null;
};

const state = vi.hoisted(() => {
  // Dispatch each select's terminal read by the drizzle table identity passed
  // to .from(...), so results are keyed by table (approvals / fees / costs)
  // instead of a fragile shared call counter. No state leaks across tests.
  const slot: Record<string, unknown[]> = { approvals: [], approval_fees: [], third_party_costs: [] };
  const tableName = (t: unknown): string =>
    (t as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] as string;
  const read = (name: string) => () => Promise.resolve(slot[name] ?? []);

  const selectImpl = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      const name = tableName(table);
      return {
        leftJoin: vi.fn(() => ({ where: read(name) })),
        where: read(name),
      };
    }),
  }));

  return {
    slot,
    clear: () => {
      slot.approvals = [];
      slot.approval_fees = [];
      slot.third_party_costs = [];
    },
    select: () => selectImpl(),
  };
});

vi.mock("@/lib/db", () => ({
  db: { select: () => state.select() },
}));

import { getRegulatorySummaries } from "@/lib/search/enrichment";
import type { RegulatorySummary } from "@/lib/search/enrichment";

// Mirrors the public compare route mapping so we can assert absence never
// flips into an affirmative "no additional approval / not permitted" claim.
function publicApprovalDisplay(summary: RegulatorySummary): string {
  return summary.verifiedApprovals.length > 0
    ? "APPROVAL_VERIFIED"
    : "UNKNOWN_REQUIRES_RESEARCH";
}

const A = "550e8400-e29b-41d4-a716-446655440001";

describe("public verification behavior (verified vs pending vs absent)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.clear();
  });

  it("O-VERIFIED: a verified approval surfaces as public verified evidence", async () => {
    state.slot.approvals = [
      {
        id: "appr-1",
        activityId: A,
        name: "Healthcare facility licence",
        verificationStatus: "verified",
        authorityName: "MOHAP",
        lastVerified: "2026-01-02",
      } satisfies ApprovalRow,
    ];
    state.slot.approval_fees = []; // fees
    state.slot.third_party_costs = []; // third-party costs

    const map = await getRegulatorySummaries([A]);
    const s = map.get(A)!;
    expect(s.verifiedApprovals).toHaveLength(1);
    expect(s.verifiedApprovals[0]!.name).toBe("Healthcare facility licence");
    expect(s.verifiedApprovals[0]!.authorityName).toBe("MOHAP");
    expect(publicApprovalDisplay(s)).toBe("APPROVAL_VERIFIED");
  });

  it("O-PENDING: a pending_review approval is never shown as verified", async () => {
    state.slot.approvals = [
      {
        id: "appr-p",
        activityId: A,
        name: "Regulatory approval — pending",
        verificationStatus: "pending_review",
        authorityName: null,
        lastVerified: null,
      } satisfies ApprovalRow,
    ];
    state.slot.approval_fees = [];
    state.slot.third_party_costs = [];

    const s = (await getRegulatorySummaries([A])).get(A)!;
    expect(s.verifiedApprovals).toHaveLength(0);
    expect(publicApprovalDisplay(s)).toBe("UNKNOWN_REQUIRES_RESEARCH");
  });

  it("O-MANUAL_REVIEW: unverified/needs-review approvals are not shown as verified", async () => {
    for (const st of ["unverified", "conflict"]) {
      state.clear();
      state.slot.approvals = [
        {
          id: "appr-u",
          activityId: A,
          name: "Unverified",
          verificationStatus: st,
          authorityName: null,
          lastVerified: null,
        } satisfies ApprovalRow,
      ];
      state.slot.approval_fees = [];
      state.slot.third_party_costs = [];
      const s = (await getRegulatorySummaries([A])).get(A)!;
      expect(s.verifiedApprovals).toHaveLength(0);
    }
  });

  it("M: government fees and third-party costs never mix", async () => {
    state.slot.approvals = [
      {
        id: "appr-1",
        activityId: A,
        name: "Approval",
        verificationStatus: "verified",
        authorityName: null,
        lastVerified: null,
      } satisfies ApprovalRow,
    ];
    state.slot.approval_fees = [
      { approvalId: "appr-1", amount: "1000", currency: "AED", feeType: "registration_fee" },
    ];
    state.slot.third_party_costs = [
      { approvalId: "appr-1", estimatedAmount: "5000", currency: "AED", costType: "technical_consultant" },
    ];

    const s = (await getRegulatorySummaries([A])).get(A)!;
    expect(s.govFees).toHaveLength(1);
    expect(s.govFees[0]!.amount).toBe("1000");
    expect(s.thirdPartyCosts).toHaveLength(1);
    expect(s.thirdPartyCosts[0]!.estimatedAmount).toBe("5000");
    expect(s.thirdPartyCosts.some((t) => String(t.estimatedAmount) === "1000")).toBe(false);
  });

  it("N: only fees belonging to verified approvals are surfaced", async () => {
    // Zero verified approvals -> no gov fees and no third-party costs attached.
    state.slot.approvals = [];
    state.slot.approval_fees = [
      { approvalId: "appr-unverified", amount: "999", currency: "AED", feeType: "registration_fee" },
    ];
    state.slot.third_party_costs = [];
    const s = (await getRegulatorySummaries([A])).get(A)!;
    expect(s.govFees).toHaveLength(0);
    expect(s.thirdPartyCosts).toHaveLength(0);
  });

  it("F: feeBasis and sourceId provenance pass through gov fees and third-party costs", async () => {
    state.slot.approvals = [
      {
        id: "appr-1",
        activityId: A,
        name: "Approval",
        verificationStatus: "verified",
        authorityName: null,
        lastVerified: null,
      } satisfies ApprovalRow,
    ];
    state.slot.approval_fees = [
      { approvalId: "appr-1", amount: "1000", currency: "AED", feeType: "registration_fee", feeBasis: "per_application", sourceId: "src-1" },
    ];
    state.slot.third_party_costs = [
      { approvalId: "appr-1", estimatedAmount: "5000", currency: "AED", costType: "technical_consultant", sourceId: "src-2" },
    ];

    const s = (await getRegulatorySummaries([A])).get(A)!;
    expect(s.govFees[0]!.feeBasis).toBe("per_application");
    expect(s.govFees[0]!.sourceId).toBe("src-1");
    expect(s.thirdPartyCosts[0]!.sourceId).toBe("src-2");
    // provenance pass-through must never fabricate the fee basis
    expect(s.govFees[0]!.feeBasis).not.toBe("fixed");
  });

  it("P: absence of evidence (not_confirmed-style) is never an affirmative negative", async () => {
    state.slot.approvals = []; // no approvals at all (not_confirmed creates none)
    state.slot.approval_fees = [];
    state.slot.third_party_costs = [];

    const s = (await getRegulatorySummaries([A])).get(A)!;
    expect(s.verifiedApprovals).toHaveLength(0);
    expect(publicApprovalDisplay(s)).toBe("UNKNOWN_REQUIRES_RESEARCH");
    expect(publicApprovalDisplay(s)).not.toBe("NO_ADDITIONAL_APPROVAL_VERIFIED");
  });
});

afterEach(() => {
  vi.clearAllMocks();
});