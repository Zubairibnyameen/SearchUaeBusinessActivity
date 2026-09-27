import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// Jurisdiction detail page — STEP 13 public jurisdiction detail tests.
//
// Tests verified government fee presentation (never AED 0, kept separate),
// compare navigation CTA, activity coverage wording, and correct handling of
// missing fee / no-fee states. Verifies no unsupported regulatory claims.
// ─────────────────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

// ── Database mock ────────────────────────────────────────────────────────
// The page runs a sequence of db.select() queries. Data is consumed from a
// queue (`allData`) in execution order.

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
    limit: vi.fn(() => postWhere),
    selectDistinct: vi.fn(() => makeChain()),
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

const dbMock = {
  select: vi.fn((): Record<string, unknown> => makeChain()),
  selectDistinct: vi.fn((): Record<string, unknown> => makeChain()),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

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

// ── Fixtures ─────────────────────────────────────────────────────────────

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
    description: "Dubai Multi Commodities Centre",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Query order for the jurisdiction detail page:
//  0. getIndexedJurisdiction (leftJoin activities, groupBy, limit)
//  1. activityAgg (COUNT)
//  2. licenceTypeRows (innerJoin, groupBy, orderBy, limit)
//  3. signalBreakdownRows (groupBy)
//  4. verifiedApprovalAgg (COUNT via innerJoin)
//  5. jurisdictionActivityIds (collect ids)
//  6. verifiedFeeCount (COUNT via innerJoin)
//  7. verifiedFeeRecords (selectDistinct)  <-- STEP 13 addition
//  8. activitySourceRows (Promise.all [0])
//  9. approvalSourceRows (Promise.all [1])
// 10. lastVerifiedAgg (MAX)
//
// Note: when ids.length === 0, the fee/source queries resolve to [] without
// consuming a slot (the page uses Promise.resolve([])). Our fixtures keep
// ids.length > 0 so all slots are consumed.

function defaultSlots(overrides?: {
  jurisdiction?: unknown[];
  activityCount?: unknown[];
  licenceTypes?: unknown[];
  signalBreakdown?: unknown[];
  verifiedApprovals?: unknown[];
  activityIds?: unknown[];
  verifiedFeeCount?: unknown[];
  verifiedFeeRecords?: unknown[];
  activitySources?: unknown[];
  approvalSources?: unknown[];
  lastVerified?: unknown[];
}): unknown[][] {
  return [
    overrides?.jurisdiction ?? [{ j: jur(), activityCount: 100 }],
    overrides?.activityCount ?? [{ count: 100 }],
    overrides?.licenceTypes ?? [
      { id: "lt-1", name: "Trade Licence", code: "TRD", count: 80 },
    ],
    overrides?.signalBreakdown ?? [
      { signal: "third_party_approval_indicated", count: 30 },
      { signal: "unknown", count: 70 },
    ],
    overrides?.verifiedApprovals ?? [{ count: 5 }],
    overrides?.activityIds ?? [{ id: "act-1" }, { id: "act-2" }],
    overrides?.verifiedFeeCount ?? [{ count: 3 }],
    overrides?.verifiedFeeRecords ?? [
      { approvalName: "Health Authority Approval", amount: "1500.00", feeType: "approval_fee" },
      { approvalName: "Civil Defence Permit", amount: null, feeType: "permit_fee" },
    ],
    overrides?.activitySources ?? [],
    overrides?.approvalSources ?? [],
    overrides?.lastVerified ?? [{ maxLastVerified: "2026-03-01" }],
  ];
}

// ── Setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  notFoundMock.mockClear();
  dataIdx = 0;
  allData = [];
});

async function renderPage(slug = "dmcc"): Promise<string> {
  const { default: Page } = await import(
    "@/app/(public)/jurisdictions/[slug]/page"
  );
  const result = await Page({ params: Promise.resolve({ slug }) });
  return renderToString(result);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("jurisdiction detail page — STEP 13", () => {
  it("T1: renders jurisdiction info", async () => {
    allData = defaultSlots();
    const html = await renderPage();
    expect(html).toContain("DMCC");
    expect(html).toContain("Dubai");
    expect(html).toContain("Free Zone");
    expect(html).toContain("Dubai Multi Commodities Centre");
  });

  it("T2: activity coverage count comes from indexed data", async () => {
    allData = defaultSlots({ activityCount: [{ count: 150 }] });
    const html = await renderPage();
    expect(html).toContain("150");
    expect(html).toContain("activities");
  });

  it("T3: verified fee records shown with amount and type", async () => {
    allData = defaultSlots();
    const html = await renderPage();
    expect(html).toContain("Verified government fees");
    expect(html).toContain("Health Authority Approval");
    // AED 1,500 (formatAed locale-formats, no trailing zeros)
    expect(html).toContain("AED 1,500");
    // titleCaseEnum lowercases: "approval fee"
    expect(html).toContain("approval fee");
  });

  it("T4: fee with missing amount shows 'Amount not published', not AED 0", async () => {
    allData = defaultSlots();
    const html = await renderPage();
    // Civil Defence Permit has amount null
    expect(html).toContain("Amount not published");
    // Never render AED 0 as a real fee value
    expect(html).not.toContain("AED 0.00");
  });

  it("T5: no verified fees shows precise empty wording", async () => {
    allData = defaultSlots({
      verifiedFeeRecords: [],
      verifiedFeeCount: [{ count: 0 }],
    });
    const html = await renderPage();
    expect(html).toContain(
      "No verified government approval fee is currently available in the indexed data"
    );
  });

  it("T6: compare CTA present in header", async () => {
    allData = defaultSlots();
    const html = await renderPage();
    expect(html).toContain("Compare this jurisdiction");
  });

  it("T7: browse CTA preserved", async () => {
    allData = defaultSlots();
    const html = await renderPage();
    expect(html).toContain("Browse all");
    expect(html).toContain("activities");
  });

  it("T8: unknown does not become prohibited", async () => {
    allData = defaultSlots({
      signalBreakdown: [
        { signal: "unknown", count: 100 },
      ],
      verifiedApprovals: [{ count: 0 }],
    });
    const html = await renderPage();
    expect(html).toContain("UNKNOWN / research required");
    expect(html).toContain("Approval coverage");
    expect(html).not.toContain("No approval required");
    expect(html).not.toContain("prohibited");
  });

  it("T9: indexed-coverage disclaimer wording is correct", async () => {
    allData = defaultSlots();
    const html = await renderPage();
    expect(html).toContain("does not imply this is the complete list of activities");
    expect(html).toContain("The number of indexed activities reflects what was captured");
  });

  it("T10: government fees shown separate from licence prices / third-party", async () => {
    allData = defaultSlots();
    const html = await renderPage();
    // The fee section explicitly disclaims separation
    expect(html).toContain("separate from licence prices and any third-party costs");
  });

  it("T11: no admin-only or reviewer info exposed", async () => {
    allData = defaultSlots();
    const html = await renderPage();
    expect(html).not.toContain("admin");
    expect(html).not.toContain("reviewer");
    expect(html).not.toContain("internal");
    expect(html).not.toContain("secret");
    expect(html).not.toContain("password");
  });
});
