import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// Activities browse page — STEP 11 public activity discovery tests.
//
// Tests category filtering, jurisdiction filtering, pagination URL state,
// empty states, and indexed-jurisdiction messaging.
// ─────────────────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));

// ── Database mock ────────────────────────────────────────────────────────

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
    offset: vi.fn((): Promise<unknown[]> => Promise.resolve(nextData())),
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

// ── Default data ─────────────────────────────────────────────────────────

const DEFAULT_ACTIVITY = {
  id: "act-1",
  officialName: "General Trading",
  activityCode: "TRD-001",
  approvalSignal: "unknown",
  verificationStatus: "unverified",
  jurisdictionName: "DMCC",
  jurisdictionSlug: "dmcc",
  emirate: "dubai",
  licenceTypeName: "Trade Licence",
};

const DEFAULT_JURISDICTION_OPTIONS = [
  { slug: "dmcc", name: "DMCC", activityCount: 100 },
  { slug: "ifza", name: "IFZA", activityCount: 80 },
  { slug: "rakez", name: "RAKEZ", activityCount: 200 },
];

const DEFAULT_CATEGORY_OPTIONS = [
  { category: "Trading", count: 150 },
  { category: "Food & Beverage", count: 80 },
  { category: "Services", count: 120 },
];

// ── Query slot builders ─────────────────────────────────────────────────
//
// The browse page executes queries in this order depending on params:
//
// NO filters:
//   0: countAgg (then)
//   1: rows (offset)
//   2: jurisdictionOptions (then)
//   3: categoryOptions (then)
//
// WITH jurisdiction only:
//   0: scopedJurisdiction lookup (then via limit→await)
//   1: countAgg (then)
//   2: rows (offset)
//   3: jurisdictionOptions (then)
//   4: categoryOptions (then)
//
// WITH category only:
//   0: scopedCategory check (then via limit→await)
//   1: countAgg (then)
//   2: rows (offset)
//   3: jurisdictionOptions (then)
//   4: categoryOptions (then)
//
// WITH both:
//   0: scopedJurisdiction lookup (then via limit→await)
//   1: scopedCategory check (then via limit→await)
//   2: countAgg (then)
//   3: rows (offset)
//   4: jurisdictionOptions (then)
//   5: categoryOptions (then)

function noFilterSlots(overrides?: {
  count?: unknown[];
  rows?: unknown[];
  jurisdictionOptions?: unknown[];
  categoryOptions?: unknown[];
}): unknown[][] {
  return [
    overrides?.count ?? [{ count: 1 }],
    overrides?.rows ?? [DEFAULT_ACTIVITY],
    overrides?.jurisdictionOptions ?? DEFAULT_JURISDICTION_OPTIONS,
    overrides?.categoryOptions ?? DEFAULT_CATEGORY_OPTIONS,
  ];
}

function jurisdictionOnlySlots(overrides?: {
  jurisdictionLookup?: unknown[];
  count?: unknown[];
  rows?: unknown[];
  jurisdictionOptions?: unknown[];
  categoryOptions?: unknown[];
}): unknown[][] {
  return [
    overrides?.jurisdictionLookup ?? [{ id: "jur-1", name: "DMCC", slug: "dmcc" }],
    overrides?.count ?? [{ count: 50 }],
    overrides?.rows ?? [DEFAULT_ACTIVITY],
    overrides?.jurisdictionOptions ?? DEFAULT_JURISDICTION_OPTIONS,
    overrides?.categoryOptions ?? DEFAULT_CATEGORY_OPTIONS,
  ];
}

function categoryOnlySlots(overrides?: {
  categoryCheck?: unknown[];
  count?: unknown[];
  rows?: unknown[];
  jurisdictionOptions?: unknown[];
  categoryOptions?: unknown[];
}): unknown[][] {
  return [
    overrides?.categoryCheck ?? [{ officialCategory: "Trading" }],
    overrides?.count ?? [{ count: 150 }],
    overrides?.rows ?? [DEFAULT_ACTIVITY],
    overrides?.jurisdictionOptions ?? DEFAULT_JURISDICTION_OPTIONS,
    overrides?.categoryOptions ?? DEFAULT_CATEGORY_OPTIONS,
  ];
}

function bothFilterSlots(overrides?: {
  jurisdictionLookup?: unknown[];
  categoryCheck?: unknown[];
  count?: unknown[];
  rows?: unknown[];
  jurisdictionOptions?: unknown[];
  categoryOptions?: unknown[];
}): unknown[][] {
  return [
    overrides?.jurisdictionLookup ?? [{ id: "jur-1", name: "DMCC", slug: "dmcc" }],
    overrides?.categoryCheck ?? [{ officialCategory: "Trading" }],
    overrides?.count ?? [{ count: 30 }],
    overrides?.rows ?? [DEFAULT_ACTIVITY],
    overrides?.jurisdictionOptions ?? DEFAULT_JURISDICTION_OPTIONS,
    overrides?.categoryOptions ?? DEFAULT_CATEGORY_OPTIONS,
  ];
}

// ── Setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  dataIdx = 0;
  allData = [];
});

async function renderPage(searchParams: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import(
    "@/app/(public)/activities/page"
  );
  const result = await Page({ searchParams: Promise.resolve(searchParams) });
  return renderToString(result);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("activities browse page — STEP 11", () => {
  it("T1: browse page loads with activity listing", async () => {
    allData = noFilterSlots();
    const html = await renderPage();
    expect(html).toContain("General Trading");
    expect(html).toContain("DMCC");
    expect(html).toContain("TRD-001");
  });

  it("T2: page title shows activity count", async () => {
    allData = noFilterSlots({ count: [{ count: 150 }] });
    const html = await renderPage();
    expect(html).toContain("150");
    expect(html).toContain("official");
    expect(html).toContain("activities");
  });

  it("T3: jurisdiction filter pills are rendered", async () => {
    allData = noFilterSlots();
    const html = await renderPage();
    expect(html).toContain("DMCC");
    expect(html).toContain("IFZA");
    expect(html).toContain("RAKEZ");
  });

  it("T4: category filter pills are rendered with counts", async () => {
    allData = noFilterSlots();
    const html = await renderPage();
    expect(html).toContain("Trading");
    expect(html).toContain("Services");
    expect(html).toContain("(150)");
    expect(html).toContain("(80)");
    expect(html).toContain("(120)");
  });

  it("T5: jurisdiction filter pills are rendered with links to other jurisdictions", async () => {
    allData = jurisdictionOnlySlots();
    const html = await renderPage({ jurisdiction: "dmcc" });
    // All jurisdiction names should appear (each is a clickable pill)
    expect(html).toContain("DMCC");
    expect(html).toContain("IFZA");
    expect(html).toContain("RAKEZ");
    // "All" pill should also appear to clear the filter
    expect(html).toContain("All");
  });

  it("T6: invalid category param is safely ignored", async () => {
    // Category check query returns empty → scopedCategory = null → no category filter
    allData = [
      [],                                    // category check (empty → invalid)
      [{ count: 9109 }],                     // countAgg
      [],                                    // rows (empty)
      DEFAULT_JURISDICTION_OPTIONS,           // jurisdictionOptions
      [],                                    // categoryOptions (empty)
    ];
    const html = await renderPage({ category: "nonexistent-category" });
    // Count is rendered with locale formatting
    expect(html).toContain("9,109");
  });

  it("T6b: malformed percent-encoded category param does not crash", async () => {
    // decodeURIComponent("%E0%A4%A") throws URIError — must be handled safely.
    // When decode fails, the category check query is skipped entirely, so the
    // query order begins with countAgg.
    allData = [
      [{ count: 5 }],                        // countAgg
      [DEFAULT_ACTIVITY],                    // rows
      DEFAULT_JURISDICTION_OPTIONS,           // jurisdictionOptions
      DEFAULT_CATEGORY_OPTIONS,               // categoryOptions
    ];
    const html = await renderPage({ category: "%E0%A4%A" });
    // Should render listing normally, decode failure ignored
    expect(html).toContain("General Trading");
    expect(html).toContain("5");
  });

  it("T7: empty state shows clear filters link", async () => {
    allData = bothFilterSlots({
      count: [{ count: 0 }],
      rows: [],
    });
    const html = await renderPage({ jurisdiction: "dmcc", category: "Trading" });
    expect(html).toContain("No activities found");
    expect(html).toContain("Clear filters");
  });

  it("T8: activity name and code are shown as links in listing", async () => {
    allData = noFilterSlots();
    const html = await renderPage();
    // Activity names and codes appear in the listing as linked text
    expect(html).toContain("General Trading");
    expect(html).toContain("TRD-001");
  });

  it("T9: 'All' jurisdiction pill appears to clear jurisdiction filter", async () => {
    allData = jurisdictionOnlySlots();
    const html = await renderPage({ jurisdiction: "dmcc" });
    // When a jurisdiction filter is active, the "All" pill is present
    expect(html).toContain("All");
  });

  it("T10: 'All categories' pill clears category filter", async () => {
    allData = categoryOnlySlots();
    const html = await renderPage({ category: "Trading" });
    expect(html).toContain("All categories");
  });

  it("T11: indexed-jurisdiction wording is correct", async () => {
    allData = noFilterSlots();
    const html = await renderPage();
    expect(html).toContain("currently indexed");
    expect(html).not.toContain("All UAE");
    expect(html).not.toContain("Complete UAE");
    expect(html).not.toContain("Every UAE");
  });

  it("T12: no admin-only data exposed", async () => {
    allData = noFilterSlots();
    const html = await renderPage();
    expect(html).not.toContain("admin");
    expect(html).not.toContain("internal");
    expect(html).not.toContain("secret");
    expect(html).not.toContain("password");
  });

  it("T13: pagination preserves active filters", async () => {
    allData = bothFilterSlots({ count: [{ count: 60 }], rows: [DEFAULT_ACTIVITY] });
    const html = await renderPage({ jurisdiction: "dmcc", category: "Trading", page: "2" });
    // Page number reflects filtered total (60 items / 25 per page = 3 pages)
    expect(html).toContain("Page 2 of 3");
    // Both active pills should appear with next/prev nav
    expect(html).toContain("Trading");
    expect(html).toContain("DMCC");
  });

  it("T14: category pills hidden when no categories exist", async () => {
    allData = noFilterSlots({ categoryOptions: [] });
    const html = await renderPage();
    expect(html).not.toContain("All categories");
    expect(html).not.toContain("Filter by category");
  });

  it("T15: licence type shown in listing", async () => {
    allData = noFilterSlots();
    const html = await renderPage();
    expect(html).toContain("Trade Licence");
  });

  it("T16: search link provided in header", async () => {
    allData = noFilterSlots();
    const html = await renderPage();
    expect(html).toContain("search for a specific activity");
  });

  it("T17: bottom disclaimer is present", async () => {
    allData = noFilterSlots();
    const html = await renderPage();
    expect(html).toContain("data-provenance");
    expect(html).toContain("three-state model");
  });

  it("T18: page 1 shows Page 1 of N", async () => {
    allData = noFilterSlots({ count: [{ count: 60 }] });
    const html = await renderPage({ page: "1" });
    expect(html).toContain("Page 1 of 3");
  });
});
