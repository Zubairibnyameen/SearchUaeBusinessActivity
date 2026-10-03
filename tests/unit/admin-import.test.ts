import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resetAuth,
  signInAsAdmin,
  signInAsUser,
  signInAsSuspended,
} from "../helpers/auth-mock";
import { renderElement } from "../helpers/render";

/**
 * /admin/import — authorization, upload validation, and the data-integrity rule.
 *
 * The importer is the real one (`importWithDb`) driven against a fake Drizzle
 * handle, so these tests exercise the actual pipeline rather than a stand-in:
 * a supported upload must arrive at the real adapter's `parse()`, and a row that
 * the real pipeline writes must not be marked verified.
 */

const state = vi.hoisted(() => {
  /** Rows the pipeline inserted into `activities`, in order. */
  const activityInserts: Record<string, unknown>[] = [];
  /** Rows the pipeline inserted into `import_review_queue`. */
  const reviewInserts: Record<string, unknown>[] = [];
  /** Rows the pipeline inserted into `sources`. */
  const sourceInserts: Record<string, unknown>[] = [];
  /** Rows the pipeline inserted into `activity_sources`. */
  const linkInserts: Record<string, unknown>[] = [];
  /** Rows the pipeline inserted into `activity_approval_signals`. */
  const signalInserts: Record<string, unknown>[] = [];
  /** Rows the pipeline inserted into `activity_source_prices`. */
  const priceInserts: Record<string, unknown>[] = [];
  /** `logAdminEvent` payloads. */
  const auditEvents: Record<string, unknown>[] = [];

  /** What the "does this activity already exist" probe should report. */
  let existingActivity: { id: string } | null = null;
  /** How many single-row probes the pipeline has made. */
  let probeCount = 0;

  return {
    activityInserts,
    reviewInserts,
    sourceInserts,
    linkInserts,
    signalInserts,
    priceInserts,
    auditEvents,
    reset() {
      activityInserts.length = 0;
      reviewInserts.length = 0;
      sourceInserts.length = 0;
      linkInserts.length = 0;
      signalInserts.length = 0;
      priceInserts.length = 0;
      auditEvents.length = 0;
      existingActivity = null;
      probeCount = 0;
    },
    /** Make the duplicate probe report "this row already exists". */
    setExistingActivity(row: { id: string } | null) {
      existingActivity = row;
    },
    /** Called by the fake db for each `limit(1)` probe. */
    probe() {
      probeCount += 1;
      // Probe 1 is the jurisdiction lookup, which must succeed.
      if (probeCount === 1) return [{ id: "jur-1", slug: "dmcc" }];
      return existingActivity ? [existingActivity] : [];
    },
    /** How many single-row probes have run — proves a page did not query. */
    probes() {
      return probeCount;
    },
  };
});

vi.mock("server-only", () => ({}));

/**
 * Minimal fluent Drizzle stand-in.
 *
 * `select().from().where().limit(1)` is the pipeline's "does the jurisdiction
 * exist" / "does this activity already exist" probe. Everything else is an
 * insert that records its values, routed by table name.
 */
function makeDb() {
  const select = () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = async (n?: number) => (n === 1 ? state.probe() : []);
    chain.offset = async () => [];
    return chain;
  };

  const record = (table: unknown, v: Record<string, unknown>) => {
    const name = tableNameOf(table);
    // Most specific first: `activity_sources` also contains "sources".
    if (name === "import_review_queue") state.reviewInserts.push(v);
    else if (name === "activity_sources") state.linkInserts.push(v);
    else if (name === "activity_approval_signals") state.signalInserts.push(v);
    else if (name === "activity_source_prices") state.priceInserts.push(v);
    else if (name === "sources") state.sourceInserts.push(v);
    else if (name === "activities") state.activityInserts.push(v);
  };

  /**
   * Drizzle insert builders are thenable *and* chainable, so `values()` may be
   * awaited directly or have `.returning()` hung off it. Mirror that.
   */
  const insertBuilder = (rows: Array<Record<string, unknown>>) => ({
    returning: async () => rows,
    then: (
      onOk?: (v: unknown) => unknown,
      onErr?: (e: unknown) => unknown
    ) => Promise.resolve(rows).then(onOk, onErr),
  });

  return {
    select,
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        record(table, { ...v });
        return insertBuilder([{ id: "row-1" }]);
      },
    }),
    update: () => ({
      set: () => ({ where: async () => [{ id: "row-1" }] }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makeDb()),
  };
}

vi.mock("@/lib/db", () => ({ db: makeDb() }));

vi.mock("@/lib/auth/viewer", async () => {
  const { authViewerMock } = await import("../helpers/auth-mock");
  return authViewerMock();
});

vi.mock("@/lib/auth/audit", () => ({
  logAdminEvent: vi.fn(async (input: Record<string, unknown>) => {
    state.auditEvents.push(input);
  }),
}));

// The form is a client component needing a React runtime, which the minimal
// walker deliberately does not provide. Stub it as a plain host element so the
// page's own server-rendered copy can still be walked and asserted on.
vi.mock("@/components/admin/import-source-form", () => ({
  ImportSourceForm: (props: Record<string, unknown>) => ({
    type: "import-source-form-stub",
    props,
  }),
}));

// The import page shows a queue preview; that DAL has its own suite. Here it is
// stubbed so these tests stay about the import path.
vi.mock("@/lib/admin/review-queue", () => ({
  listReviewItems: vi.fn(async () => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 5,
    totalPages: 1,
    pendingCount: 0,
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

// `saveRaw` writes to data/raw — keep the test off the filesystem.
vi.mock("@/lib/ingestion/raw-store", () => ({
  saveRaw: (_meta: unknown, payload: { body: Buffer; discovery: { id: string } }) => ({
    relativePath: `data/raw/dmcc/2026-01-01/${payload.discovery.id}-upload.json`,
    absolutePath: "/tmp/raw",
    sha256: "abc123",
    bytes: payload.body.length,
  }),
  sha256: () => "abc123",
}));

import { runImportAction } from "@/app/admin/import/actions";
import ImportPage from "@/app/admin/import/page";
import { ImportSourceForm } from "@/components/admin/import-source-form";
import {
  IMPORTABLE_SOURCES,
  NOT_APPROVED_SOURCES,
  loadAdapterFor,
} from "@/lib/ingestion/registry";
import {
  createUploadedSourceAdapter,
  validateUpload,
  UploadValidationError,
} from "@/lib/ingestion/upload";

/** A real IFZA-shaped JSON body, so the real adapter's parse() runs for real. */
function ifzaPayload(records: Array<Record<string, unknown>>): Buffer {
  return Buffer.from(JSON.stringify(records), "utf-8");
}

interface FoundElement {
  type: unknown;
  props: Record<string, unknown>;
}

/** Drizzle tags a table object with its SQL name under this symbol. */
const TABLE_NAME = Symbol.for("drizzle:Name");

function tableNameOf(table: unknown): string {
  return (table as Record<symbol, string | undefined>)?.[TABLE_NAME] ?? "unknown";
}

/** Depth-first search of a server-component tree for one element type. */
function findElement(node: unknown, type: unknown): FoundElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, type);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const element = node as FoundElement;
    if (element.type === type) return element;
    return findElement(element.props.children, type);
  }
  return null;
}

const ONE_IFZA_ROW = [
  {
    ID: "1",
    Activity_Name: "Cafeteria",
    Activity_Code: "IFZA-0001",
    Activity_Status: "Active",
    TPA: "false",
    Description: "Operation of a cafeteria",
    Category: "Food & Beverage",
  },
];

function formWithUpload(
  slug: string,
  file: File | null,
  extra: Record<string, string> = {}
): FormData {
  const fd = new FormData();
  fd.set("slug", slug);
  if (file) fd.set("file", file);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

function jsonFile(bytes: Buffer, name = "ifza.json"): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/json" });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.reset();
  resetAuth();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// ─── Authorization ───────────────────────────────────────────────────────────

describe("/admin/import authorization", () => {
  it("refuses an anonymous visitor and never reaches the pipeline", async () => {
    resetAuth();
    const state0 = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    expect(state0.ok).toBe(false);
    expect(state0.message).toMatch(/Administrator access is required/i);
    expect(state.activityInserts).toHaveLength(0);
  });

  it("refuses a signed-in non-admin", async () => {
    signInAsUser();
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    expect(result.ok).toBe(false);
    expect(state.activityInserts).toHaveLength(0);
  });

  it("refuses a suspended admin", async () => {
    signInAsSuspended({ role: "admin" });
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    expect(result.ok).toBe(false);
    expect(state.activityInserts).toHaveLength(0);
  });

  it("never reaches the pipeline or writes anything when the caller is not an admin", async () => {
    signInAsUser();
    await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)), { dryRun: "on" })
    );

    // A refused call must not leave an audit trail written *as* an admin: the
    // caller was never authenticated, so there is no identity to attribute.
    expect(state.auditEvents).toHaveLength(0);
    expect(state.activityInserts).toHaveLength(0);
  });

  it("audits a rejected upload from an authenticated admin", async () => {
    signInAsAdmin();
    await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", new File([new Uint8Array([1, 2, 3])], "notes.txt"))
    );

    // Wrong format for IFZA: refused, and recorded as a failure.
    expect(state.auditEvents).toHaveLength(1);
    expect(state.auditEvents[0]!.event).toBe("import.rejected");
    expect(state.auditEvents[0]!.outcome).toBe("failure");
    expect(state.activityInserts).toHaveLength(0);
  });

  it("does not render the import page for a non-admin", async () => {
    signInAsUser();
    await expect(ImportPage()).rejects.toThrow();
    // It never even reads the queue.
    expect(state.probes()).toBe(0);
  });

  it("offers only importable sources on the page", async () => {
    signInAsAdmin();
    const tree = await ImportPage();

    // The form is a client component (`useActionState`), which the minimal
    // walker cannot execute, so inspect the element tree it was handed instead
    // of rendering it. What matters here is which sources reach the form.
    const form = findElement(tree, ImportSourceForm);
    expect(form).toBeTruthy();
    const sources = form!.props.sources as Array<{ slug: string; label: string }>;
    expect(sources.map(s => s.slug).sort()).toEqual(
      IMPORTABLE_SOURCES.map(s => s.slug).sort()
    );
    for (const blocked of NOT_APPROVED_SOURCES) {
      expect(sources.map(s => s.slug)).not.toContain(blocked.slug);
    }
  });

  it("states on the page that an import is not verified data", async () => {
    signInAsAdmin();
    const rendered = await renderElement(await ImportPage());
    // The page's own copy must say plainly that an import lands as source data
    // awaiting review, not as a verified regulatory claim.
    expect(rendered.text).toContain("pending_review");
    expect(rendered.text).toContain("last_verified");
    expect(rendered.text.toLowerCase()).toContain("not a verified fact");
  });
});

// ─── Source selection ────────────────────────────────────────────────────────

describe("/admin/import source selection", () => {
  it("rejects an unsupported jurisdiction", async () => {
    signInAsAdmin();
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("shams", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.slug).toBeDefined();
    expect(state.activityInserts).toHaveLength(0);
  });

  it("refuses to load an adapter for a known-but-unapproved jurisdiction", async () => {
    const unapproved = NOT_APPROVED_SOURCES[0]!;
    await expect(loadAdapterFor(unapproved.slug)).rejects.toThrow(
      /has not been approved/i
    );
  });

  it("refuses to load an entirely unknown slug", async () => {
    await expect(loadAdapterFor("atlantis")).rejects.toThrow(/Unknown source/i);
  });

  it("only lists sources that have a real adapter", () => {
    for (const source of IMPORTABLE_SOURCES) {
      expect(source.slug).toBeTruthy();
      expect(source.formats.length).toBeGreaterThan(0);
      expect(NOT_APPROVED_SOURCES.map(s => s.slug)).not.toContain(source.slug);
    }
  });
});

// ─── Upload validation ───────────────────────────────────────────────────────

describe("/admin/import upload validation", () => {
  it("rejects a request with no file", async () => {
    signInAsAdmin();
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", null)
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.file).toMatch(/choose a source file/i);
    expect(state.activityInserts).toHaveLength(0);
  });

  it("rejects an empty file", async () => {
    signInAsAdmin();
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", new File([], "ifza.json"))
    );

    expect(result.ok).toBe(false);
    expect(state.activityInserts).toHaveLength(0);
  });

  it("rejects a file whose format the source does not publish", async () => {
    signInAsAdmin();
    // DMCC publishes XLSX; a JSON upload must be refused, not parsed.
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("dmcc", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.file).toMatch(/\.xlsx/i);
    expect(state.activityInserts).toHaveLength(0);
  });

  it("rejects a file with no usable extension", async () => {
    signInAsAdmin();
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW), "payload"))
    );

    expect(result.ok).toBe(false);
    expect(state.activityInserts).toHaveLength(0);
  });

  it("rejects a binary file whose bytes contradict its .xlsx extension", async () => {
    expect(() =>
      validateUpload(
        { slug: "dmcc", formats: ["xlsx"] },
        { filename: "list.xlsx", bytes: Buffer.from("not a zip container at all") }
      )
    ).toThrow(UploadValidationError);
  });

  it("rejects an oversized upload before parsing it", () => {
    expect(() =>
      validateUpload(
        { slug: "ifza", formats: ["json"] },
        { filename: "big.json", bytes: Buffer.alloc(26 * 1024 * 1024) }
      )
    ).toThrow(/too large/i);
  });

  it("rejects malformed JSON instead of importing nothing quietly", async () => {
    signInAsAdmin();
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(Buffer.from("{ not json", "utf-8")))
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/could not be completed/i);
    expect(state.activityInserts).toHaveLength(0);
  });

  it("rejects a JSON payload that is not the shape the source publishes", async () => {
    signInAsAdmin();
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(Buffer.from(JSON.stringify({ oops: true }))))
    );

    expect(result.ok).toBe(false);
    expect(state.activityInserts).toHaveLength(0);
  });
});

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("/admin/import runs the existing importer", () => {
  it("a supported upload reaches the source's own adapter and is imported", async () => {
    signInAsAdmin();
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    expect(result.ok).toBe(true);
    expect(result.summary?.rowsDiscovered).toBe(1);
    expect(result.summary?.rowsAccepted).toBe(1);
    // The real IFZA adapter parsed the body — the code it extracted is ours.
    expect(state.activityInserts).toHaveLength(1);
    expect(state.activityInserts[0]).toMatchObject({
      activityCode: "IFZA-0001",
      officialName: "Cafeteria",
    });
  });

  it("reports every counter the admin needs to judge the run", async () => {
    signInAsAdmin();
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload(
        "ifza",
        jsonFile(
          ifzaPayload([
            ONE_IFZA_ROW[0]!,
            // Same code in the same batch → not silently discarded: the second
            // row is written to the review queue instead.
            { ...ONE_IFZA_ROW[0]!, ID: "2", Activity_Name: "Cafeteria (branch)" },
          ])
        )
      )
    );

    const s = result.summary!;
    expect(s.rowsDiscovered).toBe(2);
    expect(s.rowsAccepted).toBe(1);
    expect(s.rowsSkippedDuplicate).toBe(1);
    expect(s.reviewItemsCreated).toBe(1);
    expect(Array.isArray(s.errors)).toBe(true);
    expect(Array.isArray(s.warnings)).toBe(true);
    expect(s.reviewNotes.join(" ")).toMatch(/batch-duplicate/i);
    // The full original row is preserved for a human, not dropped.
    expect(state.reviewInserts).toHaveLength(1);
    expect(state.reviewInserts[0]).toMatchObject({
      reason: "batch_duplicate_code",
      activityCode: "IFZA-0001",
    });
    // Schema default is pending_review — the importer does not set a status.
    expect(state.reviewInserts[0]!.status ?? "pending_review").toBe("pending_review");
  });

  it("counts a row that already exists in the database as skipped, not accepted", async () => {
    signInAsAdmin();
    state.setExistingActivity({ id: "act-existing" });
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    expect(result.ok).toBe(true);
    expect(result.summary?.rowsAccepted).toBe(0);
    expect(result.summary?.rowsSkippedDuplicate).toBe(1);
    // Nothing was inserted, and nothing was deleted.
    expect(state.activityInserts).toHaveLength(0);
  });

  it("a dry run reports counters without writing anything", async () => {
    signInAsAdmin();
    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)), { dryRun: "on" })
    );

    expect(result.ok).toBe(true);
    expect(result.summary?.dryRun).toBe(true);
    expect(result.message).toMatch(/nothing was written/i);
    expect(state.activityInserts).toHaveLength(0);
    expect(state.sourceInserts).toHaveLength(0);
  });

  it("logs the run with the verified admin identity and counters", async () => {
    const admin = signInAsAdmin({ email: "admin@example.com" });
    await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    expect(state.auditEvents).toHaveLength(1);
    const event = state.auditEvents[0]!;
    expect(event.event).toBe("import.run");
    expect(event.outcome).toBe("success");
    expect(event.ip).toBe("203.0.113.9");
    const details = event.details as Record<string, unknown>;
    expect(details.adminId).toBe(admin.id);
    expect(details.source).toBe("ifza");
    expect(details.rowsAccepted).toBe(1);
  });

  it("cannot be made to import as a different admin", async () => {
    const admin = signInAsAdmin();
    const forged = "99999999-9999-4999-8999-999999999999";

    const result = await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)), {
        adminId: forged,
        actingAdminId: forged,
        role: "admin",
      })
    );

    expect(result.ok).toBe(true);
    const details = state.auditEvents[0]!.details as Record<string, unknown>;
    // Identity comes from the session; the posted fields are ignored entirely.
    expect(details.adminId).toBe(admin.id);
    expect(details.adminId).not.toBe(forged);
  });
});

// ─── Data integrity ──────────────────────────────────────────────────────────

describe("imported rows are source data, not verified facts", () => {
  it("writes imported activities as pending_review, never as verified", async () => {
    signInAsAdmin();
    await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    expect(state.activityInserts).toHaveLength(1);
    const row = state.activityInserts[0]!;
    expect(row.verificationStatus).toBe("pending_review");
    expect(row.verificationStatus).not.toBe("verified");
  });

  it("leaves lastVerified empty — no human has checked this row yet", async () => {
    signInAsAdmin();
    await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    const row = state.activityInserts[0]!;
    expect(row.lastVerified ?? null).toBeNull();
  });

  it("never invents an approval: approval_status stays unknown", async () => {
    signInAsAdmin();
    await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    const row = state.activityInserts[0]!;
    // Not set at all by the importer, and the DB default is `unknown`.
    expect(row.approvalStatus ?? "unknown").toBe("unknown");
  });

  it("stores a source-indicated approval as a signal, not as an approval", async () => {
    signInAsAdmin();
    await runImportAction(
      { ok: false, message: "" },
      formWithUpload(
        "ifza",
        jsonFile(
          ifzaPayload([
            {
              ID: "9",
              Activity_Name: "Money Changing",
              Activity_Code: "IFZA-0009",
              TPA: "true",
              Approving_Entity_1: "UAE Central Bank",
            },
          ])
        )
      )
    );

    // The activity keeps the *signal*, and a signal row is recorded...
    expect(state.activityInserts[0]).toMatchObject({
      approvalSignal: "third_party_approval_indicated",
    });
    expect(state.signalInserts).toHaveLength(1);
    // ...and no `approvals` table write happens anywhere in the pipeline.
    expect(state.activityInserts.some(r => "status" in r && r.status === "required")).toBe(false);
  });

  it("does not fabricate fees: no price row without a published price", async () => {
    signInAsAdmin();
    await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    expect(state.priceInserts).toHaveLength(0);
  });

  it("every activity still requires a source link", async () => {
    signInAsAdmin();
    await runImportAction(
      { ok: false, message: "" },
      formWithUpload("ifza", jsonFile(ifzaPayload(ONE_IFZA_ROW)))
    );

    expect(state.linkInserts).toHaveLength(1);
    expect(state.sourceInserts).toHaveLength(1);
    expect(state.linkInserts[0]!.activityId).toBe("row-1");
    expect(state.linkInserts[0]!.sourceId).toBe("row-1");
  });
});

// ─── Uploaded adapter wrapper ────────────────────────────────────────────────

describe("uploaded source adapter", () => {
  it("reuses the base adapter's parse and normalize", async () => {
    signInAsAdmin();
    const base = await (await import("@/lib/ingestion/registry")).loadAdapterFor("ifza");
    const wrapped = createUploadedSourceAdapter(
      base,
      { filename: "up.json", bytes: ifzaPayload(ONE_IFZA_ROW) },
      "json"
    );

    const parsed = await wrapped.parse({
      discovery: { id: "admin-upload", label: "l", url: "u", format: "json" },
      body: ifzaPayload(ONE_IFZA_ROW),
      fetchedAt: new Date(),
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.officialName).toBe("Cafeteria");
    // normalize() is the base adapter's, not a reimplementation.
    expect(wrapped.normalize(parsed[0]!).normalizedName).toBe(base.normalize(parsed[0]!).normalizedName);
  });

  it("tags provenance as an admin upload, not a crawl", async () => {
    const base = await loadAdapterFor("ifza");
    const wrapped = createUploadedSourceAdapter(
      base,
      { filename: "up.json", bytes: Buffer.from("[]") },
      "json"
    );
    const discovered = await wrapped.discover();

    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.id).toBe("admin-upload");
    expect(discovered[0]!.notes).toMatch(/admin upload/i);
  });
});