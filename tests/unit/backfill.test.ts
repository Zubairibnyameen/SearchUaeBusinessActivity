import { describe, it, expect } from "vitest";
import { hasSameSignal, planBackfill } from "@/lib/ingestion/backfill";
import type { ActivitySignalSnapshot } from "@/lib/ingestion/backfill";

const base: ActivitySignalSnapshot = {
  approvalSignal: "unknown",
  approvalStatus: "unknown",
  verificationStatus: "unverified",
};

function snapshot(
  over: Partial<ActivitySignalSnapshot>
): ActivitySignalSnapshot {
  return { ...base, ...over };
}

describe("planBackfill", () => {
  it("returns insert_signal when the source names an approving authority", () => {
    const plan = planBackfill(snapshot({}), {
      signal: "third_party_approval_indicated",
      signalType: "third_party_approval_required",
      authorityName: "Dubai Health Authority",
      notes: "Approving regulator named in official DMCC list",
    });
    expect(plan.kind).toBe("insert_signal");
    expect(plan.signalDetail?.signalType).toBe("third_party_approval_required");
    expect(plan.signalDetail?.authorityName).toBe("Dubai Health Authority");
    expect(plan.needsSignalUpdate).toBe(true);
  });

  it("does not force a signal update when the activity already indicates it", () => {
    const plan = planBackfill(
      snapshot({ approvalSignal: "third_party_approval_indicated" }),
      {
        signal: "third_party_approval_indicated",
        signalType: "third_party_approval_required",
        authorityName: "RTA",
      }
    );
    expect(plan.kind).toBe("insert_signal");
    expect(plan.needsSignalUpdate).toBe(false);
  });

  it("insert_signal also drops a legacy no_additional_approval claim", () => {
    const plan = planBackfill(
      snapshot({ approvalStatus: "no_additional_approval", verificationStatus: "verified" }),
      {
        signal: "third_party_approval_indicated",
        signalType: "third_party_approval_required",
        authorityName: "RTA",
      }
    );
    expect(plan.kind).toBe("insert_signal");
    expect(plan.patch?.approvalStatus).toBe("unknown");
    expect(plan.patch?.verificationStatus).toBe("unverified");
  });

  it("ignores vague signals without an authority name (absence of evidence)", () => {
    const plan = planBackfill(
      snapshot({ approvalStatus: "no_additional_approval", verificationStatus: "verified" }),
      { signal: "no_signal", signalType: undefined, authorityName: undefined }
    );
    expect(plan.kind).toBe("update_status");
    expect(plan.patch?.approvalStatus).toBe("unknown");
    expect(plan.patch?.verificationStatus).toBe("unverified");
  });

  it("corrects legacy no_additional_approval/verified on rows with no evidence", () => {
    const plan = planBackfill(
      snapshot({ approvalStatus: "no_additional_approval", verificationStatus: "verified" }),
      undefined
    );
    expect(plan.kind).toBe("update_status");
    expect(plan.patch?.approvalStatus).toBe("unknown");
    expect(plan.patch?.verificationStatus).toBe("unverified");
  });

  it("is a noop for a row that already reflects an honest unknown state", () => {
    const plan = planBackfill(
      snapshot({ approvalStatus: "unknown", verificationStatus: "unverified" }),
      undefined
    );
    expect(plan.kind).toBe("noop");
  });

  it("is a noop when the only legacy values are already corrected but evidence is absent", () => {
    const plan = planBackfill(
      snapshot({ approvalStatus: "unknown", verificationStatus: "pending_review" }),
      undefined
    );
    expect(plan.kind).toBe("noop");
  });
});

describe("hasSameSignal", () => {
  it("returns true when the exact type+authority already exists", () => {
    const existing = [
      { signalType: "third_party_approval_required", authorityName: "DHA" },
      { signalType: "restriction_noted", authorityName: null },
    ];
    expect(
      hasSameSignal(existing, {
        signal: "third_party_approval_indicated",
        signalType: "third_party_approval_required",
        authorityName: "DHA",
      })
    ).toBe(true);
  });

  it("returns false when type matches but authority differs", () => {
    const existing = [
      { signalType: "third_party_approval_required", authorityName: "RTA" },
    ];
    expect(
      hasSameSignal(existing, {
        signal: "third_party_approval_indicated",
        signalType: "third_party_approval_required",
        authorityName: "DHA",
      })
    ).toBe(false);
  });

  it("returns false when the incoming signal has no type", () => {
    const existing = [
      { signalType: "third_party_approval_required", authorityName: "RTA" },
    ];
    expect(
      hasSameSignal(existing, { signal: "no_signal", signalType: undefined })
    ).toBe(false);
  });

  it("is case-sensitive on authority for faithful round-trips", () => {
    const existing = [
      { signalType: "third_party_approval_required", authorityName: "Dubai Health Authority" },
    ];
    expect(
      hasSameSignal(existing, {
        signal: "third_party_approval_indicated",
        signalType: "third_party_approval_required",
        authorityName: "Dubai Health Authority",
      })
    ).toBe(true);
  });
});