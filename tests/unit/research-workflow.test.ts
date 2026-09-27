import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// Flexible @/lib/db mock that supports every query shape used by the
// research workflow actions:
//   db.update(t).set(v).where(p).returning(...)   -> resolves rows
//   db.update(t).set(v).where(p)                  -> thenable (resolves)
//   db.select().from(t).where(p).limit(1)         -> resolves pre-fetch rows
//   db.insert(t).values(v).returning({id})        -> resolves rows
// The `where(p)` result is a Promise that also carries `.returning()` so both
// the returning and non-returning update paths work without conflict.
// All mutable test state is defined via vi.hoisted so the hoisted vi.mock
// factories can reference it safely.
// ─────────────────────────────────────────────────────────────────────────
const state = vi.hoisted(() => {
  const plan = {
    preFetch: [] as unknown[],
    claimReturning: [] as unknown[],
    insertReturning: [] as unknown[],
    insertValues: [] as Record<string, unknown>[],
  };

  let isAdminAuthed = true;
  const auditEvents: string[] = [];

  function thenableWithReturning(rows: unknown[]) {
    const p = Promise.resolve(rows as { id?: string }[]);
    Object.assign(p, { returning: async () => rows as { id?: string }[] });
    return p as Promise<{ id?: string }[]> & {
      returning: () => Promise<{ id?: string }[]>;
    };
  }

  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(plan.preFetch)) })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => thenableWithReturning(plan.claimReturning)),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        plan.insertValues.push(v);
        return { returning: vi.fn(() => Promise.resolve(plan.insertReturning)) };
      }),
    })),
  };

  return {
    plan,
    dbMock,
    setAdmin: (v: boolean) => (isAdminAuthed = v),
    isAdminAuthed: () => isAdminAuthed,
    recordAudit: (event: string) => auditEvents.push(event),
    reset: () => {
      auditEvents.length = 0;
      plan.preFetch = [];
      plan.claimReturning = [];
      plan.insertReturning = [];
      plan.insertValues = [];
    },
    lastAudit: () => auditEvents[auditEvents.length - 1] ?? null,
  };
});

vi.mock("@/lib/db", () => ({ db: state.dbMock }));
vi.mock("@/lib/auth", () => ({
  isAdminAuthenticated: vi.fn(() => Promise.resolve(state.isAdminAuthed())),
  logAdminEvent: vi.fn(async (input: { event: string }) => state.recordAudit(input.event)),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({ get: () => null })),
  cookies: vi.fn(() => Promise.resolve({ get: () => undefined })),
}));

import {
  claimResearch,
  releaseResearch,
  markNotConfirmed,
  flagManualReview,
  saveResearchNotes,
  resolveNotRequired,
} from "@/app/admin/research/actions";

const VALID_ID = "550e8400-e29b-41d4-a716-446655440000";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

describe("research workflow — authentication & authorization", () => {
  beforeEach(() => {
    state.setAdmin(true);
    state.reset();
    vi.clearAllMocks();
  });

  it("rejects unauthenticated callers and performs no database writes", async () => {
    state.setAdmin(false);
    await expect(claimResearch(form({ id: VALID_ID }))).rejects.toThrow("Unauthorized");
    await expect(saveResearchNotes(form({ id: VALID_ID, notes: "" }))).rejects.toThrow("Unauthorized");
    expect(state.dbMock.update).not.toHaveBeenCalled();
    expect(state.dbMock.insert).not.toHaveBeenCalled();
  });
});

describe("research workflow — Zod input validation (no DB touch on bad input)", () => {
  beforeEach(() => {
    state.setAdmin(true);
    state.reset();
    vi.clearAllMocks();
  });

  it("rejects a non-UUID research id", async () => {
    await expect(claimResearch(form({ id: "not-a-uuid" }))).rejects.toThrow(/id/);
    expect(state.dbMock.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid candidate source URL on notes save", async () => {
    await expect(
      saveResearchNotes(form({ id: VALID_ID, notes: "x", candidateSourceUrl: "not-a-url" }))
    ).rejects.toThrow(/candidateSourceUrl/);
    expect(state.dbMock.update).not.toHaveBeenCalled();
  });

  it("rejects over-length notes", async () => {
    await expect(
      markNotConfirmed(form({ id: VALID_ID, reviewNotes: "a".repeat(5000) }))
    ).rejects.toThrow(/reviewNotes/);
    expect(state.dbMock.update).not.toHaveBeenCalled();
  });
});

describe("research workflow — atomic claim", () => {
  beforeEach(() => {
    state.setAdmin(true);
    state.reset();
    vi.clearAllMocks();
    state.plan.claimReturning = [{ id: VALID_ID }];
  });

  it("claims an unclaimed item successfully and audits it", async () => {
    await claimResearch(form({ id: VALID_ID }));
    expect(state.dbMock.update).toHaveBeenCalledTimes(1);
    expect(state.lastAudit()).toBe("research.claimed");
  });

  it("rejects a lost race (item already claimed) instead of overwriting", async () => {
    state.plan.claimReturning = []; // second claimer's atomic update hits zero rows
    await expect(claimResearch(form({ id: VALID_ID }))).rejects.toThrow(/already claimed/);
    expect(state.lastAudit()).toBe("research.claim_rejected_already_claimed");
  });
});

describe("research workflow — release behavior", () => {
  beforeEach(() => {
    state.setAdmin(true);
    state.reset();
    vi.clearAllMocks();
    state.plan.claimReturning = [{ id: VALID_ID }];
  });

  it("releases when the caller is the claimant", async () => {
    await releaseResearch(form({ id: VALID_ID }));
    expect(state.dbMock.update).toHaveBeenCalledTimes(1);
    expect(state.lastAudit()).toBe("research.released");
  });

  it("rejects release when the caller is not the owner (atomic guard)", async () => {
    state.plan.claimReturning = [];
    await expect(releaseResearch(form({ id: VALID_ID }))).rejects.toThrow(/not claimed by you/);
    expect(state.lastAudit()).toBe("research.release_rejected_not_owner");
  });
});

describe("research workflow — status transitions", () => {
  beforeEach(() => {
    state.setAdmin(true);
    state.reset();
    vi.clearAllMocks();
    state.plan.preFetch = [
      { id: VALID_ID, activityId: "act-1", researchStatus: "pending_review", possibleAuthority: null },
    ];
    state.plan.claimReturning = [{ id: VALID_ID }];
  });

  it("flags manual review (needs_manual_review) and audits it", async () => {
    await flagManualReview(form({ id: VALID_ID, reviewNotes: "needs human check" }));
    expect(state.dbMock.update).toHaveBeenCalledTimes(1);
    expect(state.lastAudit()).toBe("research.flagged_manual_review");
  });

  it("marks an item not_confirmed without creating any approval or negative conclusion", async () => {
    await markNotConfirmed(form({ id: VALID_ID, reviewNotes: "could not confirm via official register" }));
    expect(state.dbMock.update).toHaveBeenCalledTimes(1);
    expect(state.dbMock.insert).not.toHaveBeenCalled();
    expect(state.lastAudit()).toBe("research.marked_not_confirmed");
  });

  it("refuses to downgrade a verified item to not_confirmed", async () => {
    state.plan.preFetch = [{ id: VALID_ID, activityId: "act-1", researchStatus: "verified" }];
    await expect(
      markNotConfirmed(form({ id: VALID_ID, reviewNotes: "reconsider" }))
    ).rejects.toThrow(/Cannot change a resolved \(verified\) item/);
    expect(state.dbMock.update).not.toHaveBeenCalled();
  });

  it("resolveNotRequired records an evidence source with a content hash", async () => {
    state.plan.preFetch = [{ id: VALID_ID, activityId: "act-1", researchStatus: "pending_review", possibleAuthority: null }];
    state.plan.insertReturning = [{ id: "src-1" }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("<html>evidence</html>")); c.close(); } }),
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await resolveNotRequired(
      form({ id: VALID_ID, notRequiredSourceUrl: "https://www.example.gov.ae/evidence", rationale: "register confirms no additional permit" })
    );

    // two inserts: the evidence source, then the approval record
    const sourceInsert = state.plan.insertValues[0];
    expect(sourceInsert).toMatchObject({ url: "https://www.example.gov.ae/evidence" });
    // provenance: sha256 content hash of the fetched body is attached
    expect(String(sourceInsert?.contentHash ?? "")).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(state.lastAudit()).toBe("research.resolved_not_required");
    vi.unstubAllGlobals();
  });

  it("resolveNotRequired is rejected without an official evidence URL", async () => {
    state.plan.preFetch = [{ id: VALID_ID, activityId: "act-1", researchStatus: "pending_review", possibleAuthority: null }];
    await expect(
      resolveNotRequired(form({ id: VALID_ID, notRequiredSourceUrl: "https://example.com/random", rationale: "nope" }))
    ).rejects.toThrow(/official source/);
    expect(state.dbMock.insert).not.toHaveBeenCalled();
    expect(state.lastAudit()).toBe("research.not_required_rejected_non_official_source");
  });
});

afterEach(() => {
  vi.clearAllMocks();
});