import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resetAuth,
  signInAsAdmin,
  signInAsUser,
  signInAsSuspended,
} from "../helpers/auth-mock";
import { renderElement } from "../helpers/render";

/**
 * /admin/review — authorization, pagination, and the three review decisions.
 *
 * The DAL under test is the real one (`listReviewItems`, `getReviewItem`,
 * `resolveReviewItem`); only Drizzle is faked. Two properties matter most here:
 *
 *   1. Only an authenticated admin can act, and the acting identity comes from
 *      the session rather than from the form.
 *   2. A review decision records a judgement about a SOURCE ROW. It must never
 *      write a regulatory claim — so the only columns a decision may touch are
 *      the queue's own `status`, `resolvedAt` and `resolutionNote`.
 */

const state = vi.hoisted(() => {
  /** Rows the paginated list query returns. */
  const listRows: Record<string, unknown>[] = [];
  /** Results handed back by the two `count()` queries, in call order. */
  const countResults: number[] = [];
  /** Row returned by the single-item lookup, or null for "not found". */
  let detailRow: Record<string, unknown> | null = null;
  /** Rows the conditional UPDATE reports as matched. */
  const updateRows: Array<Record<string, unknown>> = [{ status: "verified" }];

  const updates: Array<{ table: string; set: Record<string, unknown> }> = [];
  /** `logAdminEvent` payloads. */
  const auditCalls: Array<Record<string, unknown>> = [];
  /** `console.error` output, so a swallowed failure can still be inspected. */
  const errors: string[] = [];
  /** Column name of every `select()` projection, in call order. */
  const selectColumns: string[][] = [];
  /** `{ limit, offset }` of each list query, in call order. */
  const listWindows: Array<{ limit?: number; offset?: number }> = [];
  /** Flattened WHERE predicate of each conditional UPDATE, in call order. */
  const updateWheres: string[] = [];

  return {
    listRows,
    countResults,
    updates,
    updateRows,
    updateWheres,
    auditCalls,
    errors,
    selectColumns,
    listWindows,
    reset() {
      listRows.length = 0;
      countResults.length = 0;
      detailRow = null;
      updateRows.length = 0;
      updateRows.push({ status: "verified" });
      updates.length = 0;
      updateWheres.length = 0;
      auditCalls.length = 0;
      errors.length = 0;
      selectColumns.length = 0;
      listWindows.length = 0;
    },
    setDetailRow(row: Record<string, unknown> | null) {
      detailRow = row;
    },
    /** Simulate the conditional UPDATE matching N rows. Zero = already resolved. */
    setUpdateRows(rows: Array<Record<string, unknown>>) {
      updateRows.length = 0;
      updateRows.push(...rows);
    },
    nextCount(n: number) {
      countResults.push(n);
    },
    /** Fake-db read side: decide which query is running from how it was built. */
    resolveSelect(window: { limit?: number; offset?: number }) {
      if (window.limit === undefined && window.offset === undefined) {
        return [{ n: countResults.shift() ?? 0 }];
      }
      if (window.offset === undefined && window.limit === 1) {
        return detailRow ? [detailRow] : [];
      }
      listWindows.push(window);
      const start = window.offset ?? 0;
      return listRows.slice(start, start + (window.limit ?? listRows.length));
    },
    getDetailRow() {
      return detailRow;
    },
  };
});

vi.mock("server-only", () => ({}));

/** Drizzle tags a table object with its SQL name under this symbol. */
const TABLE_NAME = Symbol.for("drizzle:Name");

function tableNameOf(table: unknown): string {
  return (table as Record<symbol, string | undefined>)?.[TABLE_NAME] ?? "unknown";
}

function makeDb() {
  const select = (columns: Record<string, unknown> = {}) => {
    state.selectColumns.push(Object.keys(columns));
    const window: { limit?: number; offset?: number } = {};
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (n: number) => {
        window.limit = n;
        return chain;
      },
      offset: (n: number) => {
        window.offset = n;
        return chain;
      },
      then: (
        onOk?: (v: unknown) => unknown,
        onErr?: (e: unknown) => unknown
      ) => Promise.resolve(state.resolveSelect(window)).then(onOk, onErr),
    };
    return chain;
  };

  return {
    select,
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        state.updates.push({ table: tableNameOf(table), set });
        const builder: Record<string, unknown> = {
          where: (cond: unknown) => {
            // The conditional guard is part of the behaviour under test, so keep
            // the predicate rather than throwing it away.
            state.updateWheres.push(describeCondition(cond));
            return builder;
          },
          returning: async () => state.updateRows,
          then: (
            onOk?: (v: unknown) => unknown,
            onErr?: (e: unknown) => unknown
          ) => Promise.resolve(state.updateRows).then(onOk, onErr),
        };
        return builder;
      },
    }),
  };
}

/**
 * Flatten a Drizzle SQL predicate into plain text.
 *
 * `eq()` wraps its value in a `Param`, so stringifying the object does not show
 * the value; `queryChunks` does. This keeps the assertion about the real guard
 * ("status = 'pending_review' AND id = ...") without reimplementing SQL.
 */
function describeCondition(condition: unknown): string {
  const chunks = (condition as { queryChunks?: unknown[] })?.queryChunks;
  if (Array.isArray(chunks)) {
    return chunks
      .map(chunk => {
        // `eq()` stores the compared value in a `Param` wrapper.
        const param = (chunk as { value?: unknown }).value;
        if (param !== undefined) return String(param);
        // `and()` / `sql` nest further SQL objects.
        if (chunk && typeof chunk === "object" && "queryChunks" in chunk) {
          return describeCondition(chunk);
        }
        return "";
      })
      .filter(Boolean)
      .join(" AND ");
  }
  return String(condition);
}

vi.mock("@/lib/db", () => ({ db: makeDb() }));

vi.mock("@/lib/auth/viewer", async () => {
  const { authViewerMock } = await import("../helpers/auth-mock");
  return authViewerMock();
});

vi.mock("@/lib/auth/audit", () => ({
  logAdminEvent: vi.fn(async (input: Record<string, unknown>) => {
    state.auditCalls.push(input);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.7" }),
}));

import { resolveReviewAction } from "@/app/admin/review/actions";
import {
  listReviewItems,
  getReviewItem,
  resolveReviewItem,
  REVIEW_MAX_PAGE_SIZE,
  REVIEW_PAGE_SIZE,
  ReviewActionError,
} from "@/lib/admin/review-queue";
import ReviewPage from "@/app/admin/review/page";

const ITEM_ID = "3f1b9c4e-2a7d-4c8b-9e15-6d2f8a4b7c10";

function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    jurisdictionName: "Dubai Multi Commodities Centre",
    jurisdictionSlug: "dmcc",
    activityCode: "IFZA-0001",
    normalizedName: "cafeteria",
    zone: null,
    reason: "batch_duplicate_code",
    status: "pending_review",
    discoveryId: "admin-upload",
    createdAt: new Date("2026-02-01T10:00:00.000Z"),
    resolvedAt: null,
    hasRaw: true,
    ...overrides,
  };
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

function reviewForm(decision: string, note?: string): FormData {
  return form({
    id: ITEM_ID,
    decision,
    ...(note === undefined ? {} : { note }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.reset();
  resetAuth();
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  state.errors.push(
    args.map(a => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" | ")
  );
});
});

/** Shorthand for the audit payloads collected during a test. */
const auditCalls = state.auditCalls;

// ─── Authorization ───────────────────────────────────────────────────────────

describe("/admin/review authorization", () => {
  it("refuses an anonymous caller", async () => {
    resetAuth();
    const result = await resolveReviewAction({ ok: false, message: "" }, reviewForm("approve"));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Administrator access is required/i);
    expect(state.updates).toHaveLength(0);
  });

  it("refuses a signed-in non-admin", async () => {
    signInAsUser();
    const result = await resolveReviewAction({ ok: false, message: "" }, reviewForm("approve"));

    expect(result.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });

  it("refuses a suspended admin", async () => {
    signInAsSuspended({ role: "admin" });
    const result = await resolveReviewAction({ ok: false, message: "" }, reviewForm("reject", "nope"));

    expect(result.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it("does not let the page render the queue for a non-admin", async () => {
    signInAsUser();
    // The page calls requireAdmin(); an auth failure surfaces as a thrown error
    // rather than an empty queue, so nothing about the data leaks.
    await expect(
      ReviewPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow();

    expect(state.listWindows).toHaveLength(0);
  });

  it("renders the queue for an admin", async () => {
    signInAsAdmin();
    state.listRows.push(reviewRow());
    state.nextCount(1);
    state.nextCount(1);

    const rendered = await renderElement(await ReviewPage({ searchParams: Promise.resolve({}) }));

    expect(rendered.text).toContain("Dubai Multi Commodities Centre");
    expect(rendered.text).toContain("IFZA-0001");
    // A reviewer sees what the reason means, and the raw stored code for tracing.
    expect(rendered.text).toMatch(/duplicate activity code/i);
    expect(rendered.text).toContain("batch_duplicate_code");
    expect(rendered.text).toContain("admin-upload");
    expect(state.listWindows).toEqual([{ limit: REVIEW_PAGE_SIZE, offset: 0 }]);
  });
});

// ─── Request validation ──────────────────────────────────────────────────────

describe("/admin/review request validation", () => {
  it("rejects an id that is not a uuid", async () => {
    signInAsAdmin();
    const result = await resolveReviewAction(
      { ok: false, message: "" },
      form({ id: "1 OR 1=1", decision: "approve" })
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/review item id is not valid/i);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects an unknown decision", async () => {
    signInAsAdmin();
    const result = await resolveReviewAction(
      { ok: false, message: "" },
      form({ id: ITEM_ID, decision: "delete-everything" })
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/unknown review action/i);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects a missing decision", async () => {
    signInAsAdmin();
    const result = await resolveReviewAction(
      { ok: false, message: "" },
      form({ id: ITEM_ID })
    );

    expect(result.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects an unbounded note", async () => {
    signInAsAdmin();
    const result = await resolveReviewAction(
      { ok: false, message: "" },
      reviewForm("reject", "x".repeat(2001))
    );

    expect(result.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it("requires a reason to reject", async () => {
    signInAsAdmin();
    const result = await resolveReviewAction({ ok: false, message: "" }, reviewForm("reject"));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/explain why/i);
    expect(state.updates).toHaveLength(0);
  });

  it("treats a whitespace-only rejection reason as no reason", async () => {
    signInAsAdmin();
    const result = await resolveReviewAction({ ok: false, message: "" }, reviewForm("reject", "   "));

    expect(result.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });
});

// ─── Approve ─────────────────────────────────────────────────────────────────

describe("/admin/review approve", () => {
  it("records acceptance, resolves the row, and audits the reviewer", async () => {
    const admin = signInAsAdmin();
    state.setUpdateRows([{ status: "verified" }]);

    const result = await resolveReviewAction(
      { ok: false, message: "" },
      reviewForm("approve", "Duplicate of the row already in the dataset")
    );

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/accepted/i);
    // Explicit that no regulatory claim was manufactured.
    expect(result.message).toMatch(/no regulatory claim/i);

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.table).toBe("import_review_queue");
    expect(state.updates[0]!.set).toMatchObject({
      status: "verified",
      resolutionNote: "Duplicate of the row already in the dataset",
    });
    expect(state.updates[0]!.set.resolvedAt).toBeInstanceOf(Date);

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]!.event).toBe("review.approved");
    expect(auditCalls[0]!.outcome).toBe("success");
    expect(auditCalls[0]!.ip).toBe("198.51.100.7");
    expect(auditCalls[0]!.details).toMatchObject({
      adminId: admin.id,
      reviewItemId: ITEM_ID,
      decision: "approve",
      status: "verified",
    });
  });

  it("cannot be made to act as a different admin", async () => {
    const admin = signInAsAdmin();
    const forged = "99999999-9999-4999-8999-999999999999";

    await resolveReviewAction(
      { ok: false, message: "" },
      form({
        id: ITEM_ID,
        decision: "approve",
        adminId: forged,
        reviewerId: forged,
        actorId: forged,
      })
    );

    const details = auditCalls[0]!.details as Record<string, unknown>;
    expect(details.adminId).toBe(admin.id);
    expect(details.adminId).not.toBe(forged);
    expect(details).not.toHaveProperty("reviewerId");
  });

  it("only ever writes the queue's own decision columns", async () => {
    signInAsAdmin();
    await resolveReviewAction({ ok: false, message: "" }, reviewForm("approve"));

    const written = Object.keys(state.updates[0]!.set).sort();
    expect(written).toEqual(["resolutionNote", "resolvedAt", "status"]);

    // The write is also guarded on the row STILL being pending, which is what
    // makes a repeat submit or a race a no-op instead of a silent overwrite.
    expect(state.updateWheres).toHaveLength(1);
    expect(state.updateWheres[0]).toContain("pending_review");
    expect(state.updateWheres[0]).toContain(ITEM_ID);
    // No activity, approval, fee or user column can be reached from here.
    for (const forbidden of [
      "approvalStatus",
      "verificationStatus",
      "lastVerified",
      "role",
      "status_user",
      "activityId",
    ]) {
      expect(state.updates[0]!.set).not.toHaveProperty(forbidden);
    }
  });
});

// ─── Reject ──────────────────────────────────────────────────────────────────

describe("/admin/review reject", () => {
  it("marks the row unverified, keeps the reason, and resolves it", async () => {
    signInAsAdmin();
    state.setUpdateRows([{ status: "unverified" }]);

    const result = await resolveReviewAction(
      { ok: false, message: "" },
      reviewForm("reject", "Wrong zone — this code belongs to the Freezone list")
    );

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/rejected/i);
    expect(state.updates[0]!.set).toMatchObject({
      status: "unverified",
      resolutionNote: "Wrong zone — this code belongs to the Freezone list",
    });
    expect(state.updates[0]!.set.resolvedAt).toBeInstanceOf(Date);
    expect(auditCalls[0]!.event).toBe("review.rejectd");
  });
});

// ─── Leave pending ───────────────────────────────────────────────────────────

describe("/admin/review leave pending", () => {
  it("keeps the row pending and does NOT stamp it resolved", async () => {
    signInAsAdmin();
    state.setUpdateRows([{ status: "pending_review" }]);

    const result = await resolveReviewAction(
      { ok: false, message: "" },
      reviewForm("pending", "Need a second opinion on the zone")
    );

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/left pending/i);
    expect(state.updates[0]!.set.status).toBe("pending_review");
    expect(state.updates[0]!.set.resolutionNote).toBe("Need a second opinion on the zone");
    // The whole point of "leave pending": the item stays in the queue.
    expect(state.updates[0]!.set).not.toHaveProperty("resolvedAt");
    expect(auditCalls[0]!.event).toBe("review.kept_pending");
    expect(auditCalls[0]!.details).toMatchObject({ status: "pending_review" });
  });
});

// ─── Repeat / concurrent submits ─────────────────────────────────────────────

describe("/admin/review duplicate submissions", () => {
  it("refuses a second submit after the row is already resolved", async () => {
    signInAsAdmin();
    state.setUpdateRows([]); // The conditional UPDATE matched nothing.

    const result = await resolveReviewAction({ ok: false, message: "" }, reviewForm("approve"));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already been reviewed/i);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]!.event).toBe("review.action_rejected");
    expect(auditCalls[0]!.details).toMatchObject({ reason: "already_resolved" });
  });

  it("does not overwrite the first decision when a second admin races the first", async () => {
    signInAsAdmin();
    state.setUpdateRows([]);

    await resolveReviewAction({ ok: false, message: "" }, reviewForm("reject", "first call wins"));

    // Exactly one conditional statement was attempted and it matched nothing:
    // no second write of a different status, no silent overwrite.
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.set.status).toBe("unverified");
  });

  it("surfaces an unexpected failure as a generic message, not a stack trace", async () => {
    signInAsAdmin();
    const { db } = await import("@/lib/db");
    vi.spyOn(db as unknown as { update: () => unknown }, "update").mockImplementation(() => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2");
    });

    const result = await resolveReviewAction({ ok: false, message: "" }, reviewForm("approve"));

    expect(result.ok).toBe(false);
    expect(result.message).not.toMatch(/hunter2|5432|ECONNREFUSED/);
    expect(result.message).toMatch(/could not be completed/i);
  });
});

// ─── DAL: pagination and reads ───────────────────────────────────────────────

describe("review queue pagination", () => {
  it("asks for the first page at the default page size", async () => {
    state.nextCount(30);
    state.nextCount(12);

    const page = await listReviewItems();

    expect(state.listWindows).toEqual([{ limit: REVIEW_PAGE_SIZE, offset: 0 }]);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(REVIEW_PAGE_SIZE);
    expect(page.total).toBe(30);
    expect(page.totalPages).toBe(2);
    expect(page.pendingCount).toBe(12);
  });

  it("offsets by the page size on later pages", async () => {
    state.nextCount(30);
    state.nextCount(30);

    const page = await listReviewItems({ page: 3, pageSize: 10 });

    expect(state.listWindows).toEqual([{ limit: 10, offset: 20 }]);
    expect(page.page).toBe(3);
    expect(page.totalPages).toBe(3);
  });

  it("clamps a crafted page size instead of dumping the table", async () => {
    state.nextCount(0);
    state.nextCount(0);

    await listReviewItems({ pageSize: 100000 });

    expect(state.listWindows).toEqual([{ limit: REVIEW_MAX_PAGE_SIZE, offset: 0 }]);
  });

  it("never lets the page go below 1", async () => {
    state.nextCount(0);
    state.nextCount(0);

    const page = await listReviewItems({ page: -5, pageSize: 0 });

    expect(page.page).toBe(1);
    expect(state.listWindows).toEqual([{ limit: 1, offset: 0 }]);
  });

  it("reports at least one page when the queue is empty", async () => {
    state.nextCount(0);
    state.nextCount(0);

    const page = await listReviewItems();

    expect(page.items).toEqual([]);
    expect(page.totalPages).toBe(1);
    expect(page.pendingCount).toBe(0);
  });

  it("keeps the raw payload out of the list query but includes it on detail", async () => {
    state.nextCount(1);
    state.nextCount(1);
    state.listRows.push(reviewRow());

    await listReviewItems();

    state.setDetailRow(reviewRow({ raw: { Activity_Name: "Cafeteria" } }));
    const detail = await getReviewItem(ITEM_ID);

    // List projection: no `raw`, so a page of 25 never drags 25 whole payloads.
    expect(state.selectColumns[2]).not.toContain("raw");
    expect(detail?.raw).toEqual({ Activity_Name: "Cafeteria" });
  });

  it("returns null for an item that does not exist", async () => {
    state.setDetailRow(null);
    expect(await getReviewItem(ITEM_ID)).toBeNull();
  });
});

// ─── DAL: decision validation without an HTTP layer ──────────────────────────

describe("resolveReviewItem guards", () => {
  it("refuses an unrecognised decision before touching the database", async () => {
    await expect(
      resolveReviewItem({
        id: ITEM_ID,
        decision: "wipe" as unknown as "approve",
      })
    ).rejects.toBeInstanceOf(ReviewActionError);
    expect(state.updates).toHaveLength(0);
  });

  it("refuses a rejection with no note before touching the database", async () => {
    await expect(
      resolveReviewItem({ id: ITEM_ID, decision: "reject", note: "  " })
    ).rejects.toThrow(/explain why/i);
    expect(state.updates).toHaveLength(0);
  });
});