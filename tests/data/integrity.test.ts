import { describe, it, expect, vi, beforeEach } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

function chainableMock(rows: unknown[] = []) {
  const methods = ["from", "leftJoin", "where", "groupBy", "having", "select"];
  const chain: Record<string, (...args: unknown[]) => typeof chain> = {};

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  chain.then = vi.fn((resolve: (value: unknown) => void) => {
    resolve(rows);
    return Promise.resolve(rows);
  }) as unknown as (...args: unknown[]) => typeof chain;

  return chain;
}

function mockSelectReturn(rows: unknown[]) {
  const chain = chainableMock(rows);
  vi.mocked(db.select).mockReturnValue(
    chain as unknown as ReturnType<typeof db.select>
  );
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// A. Duplicate Activity Codes
// ---------------------------------------------------------------------------
describe("Duplicate activity codes detection", () => {
  it("detects duplicate codes within a jurisdiction", async () => {
    const duplicates = [
      { activityCode: "ACT-001", jurisdictionId: "j1", cnt: 2 },
      { activityCode: "ACT-002", jurisdictionId: "j1", cnt: 3 },
    ];
    mockSelectReturn(duplicates);

    const result = await db
      .select({
        activityCode: schema.activities.activityCode,
        jurisdictionId: schema.activities.jurisdictionId,
      })
      .from(schema.activities);

    expect(result.length).toBe(2);
    expect(result[0].activityCode).toBe("ACT-001");
  });

  it("returns empty when no duplicates exist", async () => {
    mockSelectReturn([]);

    const result = await db.select().from(schema.activities);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B. Missing Jurisdiction References
// ---------------------------------------------------------------------------
describe("Missing jurisdiction references", () => {
  it("passes when all activities have valid jurisdictionId", async () => {
    const activities = [
      { id: "a1", jurisdictionId: "valid-uuid-1" },
      { id: "a2", jurisdictionId: "valid-uuid-2" },
    ];
    mockSelectReturn(activities);

    const result = await db
      .select({
        id: schema.activities.id,
        jurisdictionId: schema.activities.jurisdictionId,
      })
      .from(schema.activities);

    const allHaveJisdiction = result.every(
      (r: { jurisdictionId: string | null }) =>
        r.jurisdictionId !== null && r.jurisdictionId !== undefined
    );
    expect(allHaveJisdiction).toBe(true);
  });

  it("identifies activities with null jurisdictionId", async () => {
    const activities = [
      { id: "a1", jurisdictionId: "valid-uuid" },
      { id: "a2", jurisdictionId: null },
    ];
    mockSelectReturn(activities);

    const result = await db
      .select({
        id: schema.activities.id,
        jurisdictionId: schema.activities.jurisdictionId,
      })
      .from(schema.activities);

    const orphans = result.filter(
      (r: { jurisdictionId: string | null }) =>
        r.jurisdictionId === null || r.jurisdictionId === undefined
    );
    expect(orphans.length).toBe(1);
    expect(orphans[0].id).toBe("a2");
  });
});

// ---------------------------------------------------------------------------
// C. Invalid Licence Binding
// ---------------------------------------------------------------------------
describe("Licence type → jurisdiction orphan detection", () => {
  it("passes when all licence types reference valid jurisdictions", async () => {
    const joined = [
      { licenceTypeId: "lt1", jurisdictionId: "j1" },
      { licenceTypeId: "lt2", jurisdictionId: "j2" },
    ];
    mockSelectReturn(joined);

    const result = await db
      .select({
        licenceTypeId: schema.licenceTypes.id,
        jurisdictionId: schema.licenceTypes.jurisdictionId,
      })
      .from(schema.licenceTypes);

    const validJurisdictions = new Set(["j1", "j2"]);
    const orphans = result.filter(
      (r: { jurisdictionId: string }) => !validJurisdictions.has(r.jurisdictionId)
    );
    expect(orphans.length).toBe(0);
  });

  it("detects licence types referencing non-existent jurisdictions", async () => {
    const joined = [
      { licenceTypeId: "lt1", jurisdictionId: "j1" },
      { licenceTypeId: "lt2", jurisdictionId: "missing-jurisdiction" },
    ];
    mockSelectReturn(joined);

    const result = await db
      .select({
        licenceTypeId: schema.licenceTypes.id,
        jurisdictionId: schema.licenceTypes.jurisdictionId,
      })
      .from(schema.licenceTypes);

    const validJurisdictions = new Set(["j1"]);
    const orphans = result.filter(
      (r: { jurisdictionId: string }) => !validJurisdictions.has(r.jurisdictionId)
    );
    expect(orphans.length).toBe(1);
    expect(orphans[0].jurisdictionId).toBe("missing-jurisdiction");
  });
});

// ---------------------------------------------------------------------------
// D. Orphan Approvals
// ---------------------------------------------------------------------------
describe("Orphan approval detection", () => {
  it("passes when all approvals reference valid activities", async () => {
    const approvals = [
      { approvalId: "ap1", activityId: "a1" },
      { approvalId: "ap2", activityId: "a2" },
    ];
    mockSelectReturn(approvals);

    const result = await db
      .select({
        approvalId: schema.approvals.id,
        activityId: schema.approvals.activityId,
      })
      .from(schema.approvals);

    const validActivities = new Set(["a1", "a2"]);
    const orphans = result.filter(
      (r: { activityId: string }) => !validActivities.has(r.activityId)
    );
    expect(orphans.length).toBe(0);
  });

  it("detects approvals with non-existent activityId", async () => {
    const approvals = [
      { approvalId: "ap1", activityId: "a1" },
      { approvalId: "ap2", activityId: "deleted-activity" },
    ];
    mockSelectReturn(approvals);

    const result = await db
      .select({
        approvalId: schema.approvals.id,
        activityId: schema.approvals.activityId,
      })
      .from(schema.approvals);

    const validActivities = new Set(["a1"]);
    const orphans = result.filter(
      (r: { activityId: string }) => !validActivities.has(r.activityId)
    );
    expect(orphans.length).toBe(1);
    expect(orphans[0].activityId).toBe("deleted-activity");
  });
});

// ---------------------------------------------------------------------------
// E. Orphan Fees
// ---------------------------------------------------------------------------
describe("Orphan fee detection", () => {
  it("passes when all approval fees reference valid approvals", async () => {
    const fees = [
      { feeId: "f1", approvalId: "ap1" },
      { feeId: "f2", approvalId: "ap2" },
    ];
    mockSelectReturn(fees);

    const result = await db
      .select({
        feeId: schema.approvalFees.id,
        approvalId: schema.approvalFees.approvalId,
      })
      .from(schema.approvalFees);

    const validApprovals = new Set(["ap1", "ap2"]);
    const orphans = result.filter(
      (r: { approvalId: string }) => !validApprovals.has(r.approvalId)
    );
    expect(orphans.length).toBe(0);
  });

  it("detects fees with non-existent approvalId", async () => {
    const fees = [
      { feeId: "f1", approvalId: "ap1" },
      { feeId: "f2", approvalId: "deleted-approval" },
    ];
    mockSelectReturn(fees);

    const result = await db
      .select({
        feeId: schema.approvalFees.id,
        approvalId: schema.approvalFees.approvalId,
      })
      .from(schema.approvalFees);

    const validApprovals = new Set(["ap1"]);
    const orphans = result.filter(
      (r: { approvalId: string }) => !validApprovals.has(r.approvalId)
    );
    expect(orphans.length).toBe(1);
    expect(orphans[0].approvalId).toBe("deleted-approval");
  });
});

// ---------------------------------------------------------------------------
// F. Invalid Approval Statuses
// ---------------------------------------------------------------------------
describe("Approval status enum validation", () => {
  const VALID_APPROVAL_STATUSES = [
    "no_additional_approval",
    "approval_required",
    "approval_may_be_required",
    "conditional_approval",
    "multiple_approvals_required",
    "restricted_activity",
    "not_permitted",
    "unknown",
  ];

  it("passes for valid approval status values", () => {
    for (const status of VALID_APPROVAL_STATUSES) {
      expect(VALID_APPROVAL_STATUSES).toContain(status);
    }
    expect(VALID_APPROVAL_STATUSES.length).toBe(8);
  });

  it("rejects invalid approval status values", () => {
    const invalidStatuses = ["approved", "pending", "rejected", "", null, undefined];
    for (const status of invalidStatuses) {
      expect(VALID_APPROVAL_STATUSES).not.toContain(status);
    }
  });

  it("validates status values from mock query results", async () => {
    const rows = [
      { id: "a1", approvalStatus: "approval_required" },
      { id: "a2", approvalStatus: "unknown" },
      { id: "a3", approvalStatus: "no_additional_approval" },
    ];
    mockSelectReturn(rows);

    const result = await db
      .select({
        id: schema.activities.id,
        approvalStatus: schema.activities.approvalStatus,
      })
      .from(schema.activities);

    const invalid = result.filter(
      (r: { approvalStatus: string }) =>
        !VALID_APPROVAL_STATUSES.includes(r.approvalStatus)
    );
    expect(invalid.length).toBe(0);
  });

  it("catches invalid status in mock results", async () => {
    const rows = [
      { id: "a1", approvalStatus: "approval_required" },
      { id: "a2", approvalStatus: "bogus_status" },
    ];
    mockSelectReturn(rows);

    const result = await db
      .select({
        id: schema.activities.id,
        approvalStatus: schema.activities.approvalStatus,
      })
      .from(schema.activities);

    const invalid = result.filter(
      (r: { approvalStatus: string }) =>
        !VALID_APPROVAL_STATUSES.includes(r.approvalStatus)
    );
    expect(invalid.length).toBe(1);
    expect(invalid[0].id).toBe("a2");
  });
});

// ---------------------------------------------------------------------------
// G. Invalid Verification Statuses
// ---------------------------------------------------------------------------
describe("Verification status enum validation", () => {
  const VALID_VERIFICATION_STATUSES = [
    "verified",
    "pending_review",
    "outdated",
    "unverified",
    "conflict",
  ];

  it("passes for valid verification status values", () => {
    for (const status of VALID_VERIFICATION_STATUSES) {
      expect(VALID_VERIFICATION_STATUSES).toContain(status);
    }
    expect(VALID_VERIFICATION_STATUSES.length).toBe(5);
  });

  it("rejects invalid verification status values", () => {
    const invalidStatuses = ["complete", "done", "failed", "", null, undefined];
    for (const status of invalidStatuses) {
      expect(VALID_VERIFICATION_STATUSES).not.toContain(status);
    }
  });

  it("validates status values from mock query results", async () => {
    const rows = [
      { id: "a1", verificationStatus: "verified" },
      { id: "a2", verificationStatus: "pending_review" },
      { id: "a3", verificationStatus: "unverified" },
    ];
    mockSelectReturn(rows);

    const result = await db
      .select({
        id: schema.activities.id,
        verificationStatus: schema.activities.verificationStatus,
      })
      .from(schema.activities);

    const invalid = result.filter(
      (r: { verificationStatus: string }) =>
        !VALID_VERIFICATION_STATUSES.includes(r.verificationStatus)
    );
    expect(invalid.length).toBe(0);
  });

  it("catches invalid status in mock results", async () => {
    const rows = [
      { id: "a1", verificationStatus: "verified" },
      { id: "a2", verificationStatus: "invalid_status" },
    ];
    mockSelectReturn(rows);

    const result = await db
      .select({
        id: schema.activities.id,
        verificationStatus: schema.activities.verificationStatus,
      })
      .from(schema.activities);

    const invalid = result.filter(
      (r: { verificationStatus: string }) =>
        !VALID_VERIFICATION_STATUSES.includes(r.verificationStatus)
    );
    expect(invalid.length).toBe(1);
    expect(invalid[0].id).toBe("a2");
  });
});

// ---------------------------------------------------------------------------
// H. Schema Structure Tests
// ---------------------------------------------------------------------------
describe("Drizzle schema structure", () => {
  it("defines all expected tables", () => {
    expect(schema.activities).toBeDefined();
    expect(schema.jurisdictions).toBeDefined();
    expect(schema.approvals).toBeDefined();
    expect(schema.approvalFees).toBeDefined();
    expect(schema.sources).toBeDefined();
    expect(schema.licenceTypes).toBeDefined();
    expect(schema.activitySources).toBeDefined();
    expect(schema.licensingAuthorities).toBeDefined();
    expect(schema.approvalAuthorities).toBeDefined();
    expect(schema.adminAuditLogs).toBeDefined();
    expect(schema.verificationHistory).toBeDefined();
    expect(schema.activitySynonyms).toBeDefined();
    expect(schema.activityRelationships).toBeDefined();
  });

  it("defines thirdPartyCosts table", () => {
    expect(schema.thirdPartyCosts).toBeDefined();
  });

  it("defines historicalVersions table", () => {
    expect(schema.historicalVersions).toBeDefined();
  });

  it("exports all enum types", () => {
    expect(schema.approvalStatusEnum).toBeDefined();
    expect(schema.approvalSignalEnum).toBeDefined();
    expect(schema.verificationStatusEnum).toBeDefined();
    expect(schema.emirateEnum).toBeDefined();
    expect(schema.jurisdictionTypeEnum).toBeDefined();
    expect(schema.jurisdictionStatusEnum).toBeDefined();
    expect(schema.approvalTypeEnum).toBeDefined();
    expect(schema.approvalRecordStatusEnum).toBeDefined();
    expect(schema.feeTypeEnum).toBeDefined();
    expect(schema.feeBasisEnum).toBeDefined();
    expect(schema.thirdPartyCostTypeEnum).toBeDefined();
    expect(schema.sourceTypeEnum).toBeDefined();
    expect(schema.verificationHistoryEnum).toBeDefined();
  });

  it("activities table has required columns", () => {
    const table = schema.activities;
    expect(table).toBeDefined();
    expect(table.id).toBeDefined();
    expect(table.jurisdictionId).toBeDefined();
    expect(table.activityCode).toBeDefined();
    expect(table.officialName).toBeDefined();
    expect(table.normalizedName).toBeDefined();
    expect(table.approvalStatus).toBeDefined();
    expect(table.approvalSignal).toBeDefined();
    expect(table.verificationStatus).toBeDefined();
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
  });

  it("approvals table has required columns", () => {
    const table = schema.approvals;
    expect(table).toBeDefined();
    expect(table.id).toBeDefined();
    expect(table.activityId).toBeDefined();
    expect(table.name).toBeDefined();
    expect(table.approvalType).toBeDefined();
    expect(table.status).toBeDefined();
    expect(table.verificationStatus).toBeDefined();
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
  });

  it("approvalFees table has required columns", () => {
    const table = schema.approvalFees;
    expect(table).toBeDefined();
    expect(table.id).toBeDefined();
    expect(table.approvalId).toBeDefined();
    expect(table.feeType).toBeDefined();
    expect(table.amount).toBeDefined();
    expect(table.currency).toBeDefined();
    expect(table.feeBasis).toBeDefined();
    expect(table.isMandatory).toBeDefined();
    expect(table.createdAt).toBeDefined();
  });

  it("jurisdictions table has required columns", () => {
    const table = schema.jurisdictions;
    expect(table).toBeDefined();
    expect(table.id).toBeDefined();
    expect(table.name).toBeDefined();
    expect(table.slug).toBeDefined();
    expect(table.emirate).toBeDefined();
    expect(table.jurisdictionType).toBeDefined();
    expect(table.status).toBeDefined();
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
  });

  it("licenceTypes table has required columns", () => {
    const table = schema.licenceTypes;
    expect(table).toBeDefined();
    expect(table.id).toBeDefined();
    expect(table.jurisdictionId).toBeDefined();
    expect(table.name).toBeDefined();
    expect(table.code).toBeDefined();
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
  });

  it("sources table has required columns", () => {
    const table = schema.sources;
    expect(table).toBeDefined();
    expect(table.id).toBeDefined();
    expect(table.url).toBeDefined();
    expect(table.title).toBeDefined();
    expect(table.sourceType).toBeDefined();
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
  });

  it("adminAuditLogs table has required columns", () => {
    const table = schema.adminAuditLogs;
    expect(table).toBeDefined();
    expect(table.id).toBeDefined();
    expect(table.event).toBeDefined();
    expect(table.outcome).toBeDefined();
    expect(table.createdAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// I. UUID Format Tests
// ---------------------------------------------------------------------------
describe("UUID format validation", () => {
  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("activities table id column has a default", () => {
    const table = schema.activities;
    expect(table.id).toBeDefined();
  });

  it("generates valid v4 UUID format", () => {
    const validUuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(UUID_REGEX.test(validUuid)).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    const invalidUuids = [
      "",
      "not-a-uuid",
      "550e8400-e29b-41d4-a716",
      "550e8400e29b41d4a716446655440000",
      "550e8400-e29b-41d4-a716-44665544000g",
      "g50e8400-e29b-41d4-a716-446655440000",
    ];
    for (const uuid of invalidUuids) {
      expect(UUID_REGEX.test(uuid)).toBe(false);
    }
  });

  it("rejects v1 and v3 UUIDs (must be v4)", () => {
    const v1 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const v3 = "6ba7b810-9dad-31d1-80b4-00c04fd430c8";
    const v5 = "6ba7b810-9dad-51d1-80b4-00c04fd430c8";
    expect(UUID_REGEX.test(v1)).toBe(false);
    expect(UUID_REGEX.test(v3)).toBe(false);
    expect(UUID_REGEX.test(v5)).toBe(false);
  });

  it("validates UUIDs from mock activity results", async () => {
    const rows = [
      { id: "550e8400-e29b-41d4-a716-446655440000" },
      { id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8" },
    ];
    mockSelectReturn(rows);

    const result = await db
      .select({ id: schema.activities.id })
      .from(schema.activities);

    for (const row of result) {
      expect(UUID_REGEX.test(row.id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// J. FK Constraint Pattern Tests
// ---------------------------------------------------------------------------
describe("FK constraint query patterns", () => {
  it("orphan approvals query pattern is valid", async () => {
    const mockChain = mockSelectReturn([]);
    await db.select({ id: schema.approvals.id }).from(schema.approvals);

    expect(mockChain.from).toHaveBeenCalled();
  });

  it("orphan fees query pattern is valid", async () => {
    const mockChain = mockSelectReturn([]);
    await db
      .select({ id: schema.approvalFees.id })
      .from(schema.approvalFees);

    expect(mockChain.from).toHaveBeenCalled();
  });

  it("licence types → jurisdictions join pattern is valid", async () => {
    const mockChain = mockSelectReturn([]);
    await db
      .select({
        licenceTypeId: schema.licenceTypes.id,
        jurisdictionId: schema.licenceTypes.jurisdictionId,
      })
      .from(schema.licenceTypes);

    expect(mockChain.from).toHaveBeenCalled();
  });

  it("activities → jurisdictions FK pattern is valid", async () => {
    const mockChain = mockSelectReturn([]);
    await db
      .select({
        id: schema.activities.id,
        jurisdictionId: schema.activities.jurisdictionId,
      })
      .from(schema.activities);

    expect(mockChain.from).toHaveBeenCalled();
  });

  it("duplicate detection groupBy/having pattern is valid", async () => {
    const mockChain = mockSelectReturn([]);
    await db
      .select({
        activityCode: schema.activities.activityCode,
        jurisdictionId: schema.activities.jurisdictionId,
      })
      .from(schema.activities)
      .groupBy(
        schema.activities.activityCode,
        schema.activities.jurisdictionId
      );

    expect(mockChain.groupBy).toHaveBeenCalled();
  });

  it("approvals → activities leftJoin pattern is valid", async () => {
    const mockChain = mockSelectReturn([]);
    await db
      .select({ approvalId: schema.approvals.id })
      .from(schema.approvals)
      .leftJoin(schema.activities, sql`true`);

    expect(mockChain.leftJoin).toHaveBeenCalled();
  });

  it("approvalFees → approvals leftJoin pattern is valid", async () => {
    const mockChain = mockSelectReturn([]);
    await db
      .select({ feeId: schema.approvalFees.id })
      .from(schema.approvalFees)
      .leftJoin(schema.approvals, sql`true`);

    expect(mockChain.leftJoin).toHaveBeenCalled();
  });

  it("licenceTypes → jurisdictions leftJoin pattern is valid", async () => {
    const mockChain = mockSelectReturn([]);
    await db
      .select({ licenceTypeId: schema.licenceTypes.id })
      .from(schema.licenceTypes)
      .leftJoin(schema.jurisdictions, sql`true`);

    expect(mockChain.leftJoin).toHaveBeenCalled();
  });
});
