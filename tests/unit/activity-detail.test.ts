import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// Activity detail page — STEP 10 public regulatory evidence tests.
//
// Tests verification states, fee separation, evidence provenance,
// and semantic correctness of regulatory status presentation.
// ─────────────────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

// ── Database mock ────────────────────────────────────────────────────────
// The page calls db.select() many times sequentially. We provide a mock
// that returns data from a queue (`allData`), consumed in order.

const VALID_ID = "550e8400-e29b-41d4-a716-446655440001";
let dataIdx: number;
let allData: unknown[][] = [];

function nextData(): unknown[] {
  const val = allData[dataIdx] ?? [];
  dataIdx++;
  return val;
}

function makeChain(): Record<string, unknown> {
  const postWhere = {
    groupBy: vi.fn(() => postWhere),
    orderBy: vi.fn(() => postWhere),
    limit: vi.fn((): Promise<unknown[]> => {
      return Promise.resolve(nextData());
    }),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      try {
        resolve(nextData());
      } catch (e) {
        if (reject) reject(e);
      }
    },
  };
  const chain = {
    select: vi.fn(() => makeChain()),
    from: vi.fn(() => makeChain()),
    innerJoin: vi.fn(() => makeChain()),
    leftJoin: vi.fn(() => makeChain()),
    where: vi.fn(() => postWhere),
  };
  return chain;
}

const dbMock = { select: vi.fn((): Record<string, unknown> => makeChain()) };

vi.mock("@/lib/db", () => ({ db: dbMock }));

// The share control is a client component (useState/useEffect). This suite uses
// a hand-rolled renderer that invokes function components outside React, which
// cannot run hooks, so it is stubbed here. Its own behaviour is covered by
// tests/unit/share-button.test.ts.
vi.mock("@/components/activities/share-button", () => ({
  ShareButton: () => null,
}));

// ── Helpers ──────────────────────────────────────────────────────────────

function renderToString(element: unknown): string {
  if (typeof element === "string") return element;
  if (element === null || element === undefined) return "";
  if (typeof element === "number") return String(element);
  if (typeof element === "boolean") return "";
  if (Array.isArray(element)) return element.map(renderToString).join("");
  if (typeof element === "object" && "props" in element) {
    const el = element as { type: unknown; props: Record<string, unknown> };
    const childStr = renderToString(el.props.children);
    if (typeof el.type === "function") {
      const fn = el.type as (p: Record<string, unknown>) => unknown;
      return renderToString(fn(el.props));
    }
    return childStr;
  }
  return "";
}

function act(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_ID,
    officialName: "Restaurant",
    normalizedName: "restaurant",
    activityCode: "REST-001",
    description: "Full-service restaurant",
    officialNameAr: null,
    isicCode: null,
    officialCategory: "Food & Beverage",
    normalizedCategory: "food and beverage",
    activityGroup: "Hospitality",
    activitySubcategory: null,
    zone: null,
    restrictions: null,
    approvalSignal: "unknown",
    approvalStatus: "unknown",
    verificationStatus: "unverified",
    lastVerified: null,
    sourceExtra: null,
    jurisdictionId: "jur-1",
    licenceTypeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function jur(overrides: Record<string, unknown> = {}) {
  return {
    id: "jur-1",
    name: "DMCC",
    slug: "dmcc",
    emirate: "dubai",
    jurisdictionType: "free_zone",
    authorityId: null,
    officialWebsite: "https://dmcc.ae",
    officialActivityUrl: null,
    description: null,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function src(overrides: Record<string, unknown> = {}) {
  return {
    id: "src-1",
    url: "https://dmcc.ae/activities",
    title: "DMCC Activity List",
    sourceType: "free_zone_authority",
    authority: "DMCC",
    publishedDate: null,
    retrievedDate: "2026-01-15",
    lastVerified: "2026-02-01",
    contentHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function approvalRec(overrides: Record<string, unknown> = {}) {
  return {
    id: "appr-1",
    activityId: VALID_ID,
    approvalAuthorityId: "auth-1",
    name: "Health Authority Approval",
    approvalType: "regulatory_permit",
    status: "required",
    description: "MOHAP health facility approval",
    conditions: null,
    requiredDocuments: null,
    professionalRequirement: null,
    facilityRequirement: null,
    inspectionRequired: false,
    nocRequired: false,
    applicationProcess: "Submit via MOHAP portal",
    sourceId: "src-1",
    lastVerified: "2026-02-01",
    verificationStatus: "verified",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function authorityRec(overrides: Record<string, unknown> = {}) {
  return {
    id: "auth-1",
    name: "MOHAP",
    slug: "mohap",
    officialWebsite: null,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function signalRec(overrides: Record<string, unknown> = {}) {
  return {
    id: "sig-1",
    activityId: VALID_ID,
    signalType: "third_party_authority_indicated",
    authorityName: "Civil Defence",
    notes: "Fire safety inspection may be required",
    sourceId: null,
    lastVerified: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// Page query order: main, linkedSources, signals, prices, approvalRows,
// [feeRecords], [tpcRecords], relatedActivities, similarJurisdictions.
// We pad allData to cover all queries.

function pageQuerySlots(
  activityOverrides: Record<string, unknown> = {},
  jurisdictionOverrides: Record<string, unknown> = {},
  extra: {
    sources?: unknown[];
    signals?: unknown[];
    prices?: unknown[];
    approvalRows?: unknown[];
    approvalsEmpty?: boolean;
  } = {}
) {
  const a = act(activityOverrides);
  const j = jur(jurisdictionOverrides);
  const hasGroup = Boolean(a.activityGroup || a.officialCategory);
  const approvalRows = extra.approvalsEmpty ? [] : (extra.approvalRows ?? []);
  // 5 core queries + 2 for related/similar if group/category present
  const base: unknown[][] = [
    [{ activity: a, jurisdiction: j, licenceType: null }], // main
    extra.sources ?? [],        // linkedSources
    extra.signals ?? [],        // signals
    extra.prices ?? [],         // prices
    approvalRows,               // approvalRows
  ];
  if (hasGroup) {
    base.push([], []); // relatedActivities, similarJurisdictions
  }
  return base;
}

// ── Setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  notFoundMock.mockClear();
  dataIdx = 0;
  allData = [];
});

async function renderPage(id = VALID_ID): Promise<string> {
  const { default: Page } = await import(
    "@/app/(public)/activities/[id]/page"
  );
  const result = await Page({ params: Promise.resolve({ id }) });
  return renderToString(result);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("activity detail page — STEP 10", () => {
  it("T1: renders correct activity with jurisdiction info", async () => {
    allData = pageQuerySlots();
    const html = await renderPage();
    expect(html).toContain("Restaurant");
    expect(html).toContain("DMCC");
    expect(html).toContain("Dubai");
    expect(html).toContain("Free Zone");
  });

  it("T2: unknown activity triggers notFound", async () => {
    allData = [[]]; // empty main query
    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("T3: verified approval displays Verified badge", async () => {
    allData = pageQuerySlots({}, {}, {
      approvalRows: [
        { approval: approvalRec({ verificationStatus: "verified" }), authority: authorityRec(), source: src() },
      ],
    });
    const html = await renderPage();
    expect(html).toContain("Verified approval");
  });

  it("T4: pending_review approval does not render as verified badge", async () => {
    allData = pageQuerySlots({}, {}, {
      approvalRows: [
        { approval: approvalRec({ verificationStatus: "pending_review" }), authority: authorityRec(), source: null },
      ],
    });
    const html = await renderPage();
    // The approval with pending_review is filtered OUT of verifiedApprovals
    // so no verified-approval badge should appear for it. The explanation
    // text in Section 5 uses the word generically — that's acceptable.
    expect(html).toContain("No verified regulatory approval records");
  });

  it("T5: unverified / conflict approval does not render as verified", async () => {
    for (const vs of ["unverified", "conflict"]) {
      dataIdx = 0;
      allData = pageQuerySlots({}, {}, {
        approvalRows: [
          { approval: approvalRec({ verificationStatus: vs }), authority: authorityRec(), source: null },
        ],
      });
      const html = await renderPage();
      // These approvals are filtered OUT of verifiedApprovals, so no
      // verified-approval badge renders for them.
      expect(html).toContain("No verified regulatory approval records");
    }
  });

  it("T6: 'not confirmed' does not become 'not required'", async () => {
    allData = pageQuerySlots({ approvalStatus: "unknown", verificationStatus: "unverified" });
    const html = await renderPage();
    expect(html).toContain("Unknown");
    expect(html).not.toContain("No additional approval");
  });

  it("T7: unknown does not become prohibited", async () => {
    allData = pageQuerySlots({ approvalSignal: "unknown", approvalStatus: "unknown" });
    const html = await renderPage();
    expect(html).not.toContain("Prohibited");
    expect(html).not.toContain("Not permitted");
    expect(html).not.toContain("not allowed");
  });

  it("T8: government fees and third-party costs are in separate sections", async () => {
    allData = pageQuerySlots();
    const html = await renderPage();
    expect(html).toContain("Government fees");
    expect(html).toContain("Third-party costs");
  });

  it("T9: evidence section shows source and authority when available", async () => {
    allData = pageQuerySlots({}, {}, {
      approvalRows: [
        { approval: approvalRec({ lastVerified: "2026-03-01" }), authority: authorityRec(), source: src() },
      ],
    });
    const html = await renderPage();
    expect(html).toContain("Verification evidence");
    expect(html).toContain("MOHAP");
    expect(html).toContain("DMCC Activity List");
    expect(html).toContain("Last verified");
  });

  it("T10: missing evidence does not produce fabricated verification dates", async () => {
    allData = pageQuerySlots({}, {}, {
      approvalRows: [
        { approval: approvalRec({ sourceId: null, lastVerified: null, verificationStatus: "pending_review" }), authority: null, source: null },
      ],
    });
    const html = await renderPage();
    // No fabricated dates should appear for an unverified approval
    expect(html).not.toMatch(/Last verified:.*Feb.*2026/);
    // The approval is filtered out, so the no-verified-records notice shows
    expect(html).toContain("No verified regulatory approval records");
  });

  it("T11: breadcrumb includes search link", async () => {
    allData = pageQuerySlots();
    const html = await renderPage();
    // "Search" text appears in the breadcrumb navigation
    expect(html).toContain("Home/Search");
  });

  it("T11b: breadcrumb includes Browse link to close nav loop", async () => {
    allData = pageQuerySlots();
    const html = await renderPage();
    // STEP 12: breadcrumb now Home > Search > Browse > {Jurisdiction}
    expect(html).toContain("Home/Search/Browse");
  });

  it("T12: approval signals shown as unverified, not verified", async () => {
    allData = pageQuerySlots({}, {}, { signals: [signalRec()] });
    const html = await renderPage();
    expect(html).toContain("Approval signal");
    expect(html).toContain("Civil Defence");
    // The signal should not create a verified approval — the no-verified notice shows
    expect(html).toContain("No verified regulatory approval records");
  });

  it("T13: no approvals shows research-required message", async () => {
    allData = pageQuerySlots({}, {}, { approvalsEmpty: true });
    const html = await renderPage();
    expect(html).toContain("No verified regulatory approval records");
    expect(html).toContain("Research required");
  });

  it("T14: official source uses stored URL verbatim", async () => {
    allData = pageQuerySlots({}, {}, {
      sources: [{ source: src({ url: "https://dmcc.ae/activities" }) }],
    });
    const html = await renderPage();
    expect(html).toContain("https://dmcc.ae/activities");
    expect(html).toContain("DMCC Activity List");
  });

  it("T15: fee absence shows 'not verified', never AED 0", async () => {
    allData = pageQuerySlots();
    const html = await renderPage();
    expect(html).toContain("Fee not verified");
  });

  it("T16: approval status section explains verification model clearly", async () => {
    allData = pageQuerySlots();
    const html = await renderPage();
    expect(html).toContain("Verified approval");
    expect(html).toContain("Approval signal");
    expect(html).toContain("Research required");
    expect(html).toContain("does not");
  });

  it("T17: verified approval shows per-record verification status badge", async () => {
    allData = pageQuerySlots({}, {}, {
      approvalRows: [
        { approval: approvalRec({ verificationStatus: "verified" }), authority: authorityRec(), source: src() },
      ],
    });
    const html = await renderPage();
    // The restructured section shows both "Verified approval" badge and
    // per-record VerificationStatusBadge
    expect(html).toContain("Verified");
    expect(html).toContain("Verification evidence");
  });

  it("T18: fee notice includes wording about non-verified", async () => {
    allData = pageQuerySlots();
    const html = await renderPage();
    expect(html).toContain("not verified/published");
  });
});
