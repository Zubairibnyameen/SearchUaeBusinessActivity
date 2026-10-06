import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for regulatory enrichment scoping.
 *
 * The bug: `enrichResponse()` built its summaries from the response's FLAT page
 * (`data.results`), while `/search` renders the GROUPED view
 * (`group.topResults`). Any card outside the flat slice got `undefined`, and the
 * card rendered `undefined` as "Not verified/published in indexed official
 * sources" — a regulatory finding the system never actually made. The same
 * mismatch existed in `getJurisdictionIntelligence()`.
 *
 * These tests pin the fixed contract:
 *   - enrichment covers exactly the activities a response renders;
 *   - a missing entry is distinguishable from "searched, nothing verified";
 *   - verified / pending / absent / unknown semantics are untouched;
 *   - no signal is ever promoted into a verified fact.
 */

// ─── db mock: dispatch each select's terminal read by table identity ─────────
type ApprovalRow = {
  id: string;
  activityId: string;
  name: string;
  verificationStatus: string;
  authorityName: string | null;
  lastVerified: string | null;
};

const state = vi.hoisted(() => {
  const slot: Record<string, unknown[]> = {
    approvals: [],
    approval_fees: [],
    third_party_costs: [],
  };
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
    /** How many `db.select()` calls the enrichment layer issued. */
    selectCount: 0,
    clear: () => {
      slot.approvals = [];
      slot.approval_fees = [];
      slot.third_party_costs = [];
      state.selectCount = 0;
    },
    select: () => {
      state.selectCount += 1;
      return selectImpl();
    },
  };
});

vi.mock("@/lib/db", () => ({
  db: { select: () => state.select() },
}));

vi.mock("next/link", () => ({
  default: ({ children }: { children?: unknown }) => children,
}));

// Client component; stubbed for the same reason as in
// search-page-pagination.test.ts. See tests/unit/share-button.test.ts for its
// behaviour.
vi.mock("@/components/activities/share-button", () => ({
  ShareButton: () => null,
}));

// The identifier copy control is a client component for the same reason; its
// jurisdiction-aware behaviour is covered in
// tests/unit/copy-identifier-button.test.ts.
vi.mock("@/components/activities/copy-identifier-button", () => ({
  CopyIdentifierButton: () => null,
}));

import {
  collectRenderedActivityIds,
  enrichResponse,
  getRegulatorySummaries,
  type RegulatorySummary,
} from "@/lib/search/enrichment";
import { SearchResultCard } from "@/components/search/search-results";
import { renderElement } from "../helpers/render";
import type {
  JurisdictionGroup,
  SearchResultItem,
  UnifiedSearchResponse,
} from "@/lib/search/types";

const A = "act-page-1";
const B = "act-page-2";
const OFF_PAGE = "act-other-page";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeItem(id: string, overrides: Partial<SearchResultItem["activity"]> = {}): SearchResultItem {
  return {
    activity: {
      id,
      officialName: `Activity ${id}`,
      normalizedName: `activity ${id}`,
      activityCode: null,
      isicCode: null,
      description: null,
      officialCategory: null,
      activityGroup: null,
      approvalSignal: "no_signal",
      approvalStatus: "unknown",
      verificationStatus: "unverified",
      lastVerified: null,
      ...overrides,
    },
    jurisdiction: {
      id: "jur-1",
      name: "DMCC",
      slug: "dmcc",
      emirate: "dubai",
      jurisdictionType: "free_zone",
    },
    licenceType: null,
    matchType: "exact",
    matchScore: 1,
    matchReasons: [],
    source: null,
  };
}

function makeGroup(
  slug: string,
  overrides: Partial<JurisdictionGroup> = {}
): JurisdictionGroup {
  return {
    jurisdiction: {
      id: `jur-${slug}`,
      slug,
      name: slug.toUpperCase(),
      emirate: "dubai",
      jurisdictionType: "free_zone",
    },
    status: "match",
    totalMatches: 1,
    bestMatchType: "exact",
    topResults: [],
    ...overrides,
  };
}

function makeResponse(
  results: SearchResultItem[],
  groups: JurisdictionGroup[],
  total = results.length
): UnifiedSearchResponse {
  return {
    query: "restaurant",
    total,
    results,
    jurisdictionGroups: groups,
    availability: {
      matchedJurisdictionSlugs: groups.filter(g => g.status === "match").map(g => g.jurisdiction.slug),
      unmatched: [],
    },
    intent: {
      primaryNoun: "restaurant",
      industryDomain: "food",
      specificityLevel: "specific",
      isGenericQuery: false,
      searchIntents: ["ACTIVITY_SEARCH"],
      jurisdictionSlug: null,
      jurisdictionName: null,
      businessTerms: ["restaurant"],
      typoCorrected: false,
    },
    meta: { tookMs: 1, candidatesEvaluated: 2, minRelevanceThreshold: 0.62 },
  };
}

const emptySummary = (): RegulatorySummary => ({
  verifiedApprovals: [],
  govFees: [],
  thirdPartyCosts: [],
});

function verifiedApproval(activityId: string, id = "appr-1"): ApprovalRow {
  return {
    id,
    activityId,
    name: "Trade licence",
    verificationStatus: "verified",
    authorityName: "DMCC",
    lastVerified: "2026-01-02",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// Which activities get enriched
// ─────────────────────────────────────────────────────────────────────────────

describe("collectRenderedActivityIds", () => {
  it("covers the flat page", () => {
    const response = makeResponse([makeItem(A), makeItem(B)], []);
    expect(collectRenderedActivityIds(response)).toEqual([A, B]);
  });

  it("covers the grouped view even when it is not a subset of the flat page", () => {
    // Defensive: if a caller ever renders a group the flat page missed, that
    // activity is still enriched rather than silently rendering "not verified".
    const response = makeResponse(
      [makeItem(A)],
      [makeGroup("dmcc", { topResults: [makeItem(A), makeItem(OFF_PAGE)] })]
    );
    expect(collectRenderedActivityIds(response)).toEqual([A, OFF_PAGE]);
  });

  it("deduplicates the overlap between the flat page and the grouped view", () => {
    const response = makeResponse(
      [makeItem(A), makeItem(B)],
      [
        makeGroup("dmcc", { topResults: [makeItem(A)] }),
        makeGroup("adgm", { topResults: [makeItem(B)] }),
      ]
    );
    expect(collectRenderedActivityIds(response)).toEqual([A, B]);
  });

  it("returns nothing for an empty response", () => {
    expect(collectRenderedActivityIds(makeResponse([], []))).toEqual([]);
  });

  it("is deterministic and ignores no_match groups", () => {
    const response = makeResponse(
      [makeItem(A)],
      [
        makeGroup("dmcc", { topResults: [makeItem(A)] }),
        makeGroup("adgm", { status: "no_match", totalMatches: 0, bestMatchType: null, topResults: [] }),
      ]
    );
    expect(collectRenderedActivityIds(response)).toEqual([A]);
    expect(collectRenderedActivityIds(response)).toEqual([A]);
  });

  it('"grouped" scope collects only what the grouped view renders', () => {
    const response = makeResponse(
      [makeItem(A), makeItem(B), makeItem(OFF_PAGE)],
      [
        makeGroup("dmcc", { topResults: [makeItem(A)] }),
        makeGroup("adgm", { topResults: [makeItem(B)] }),
      ]
    );
    // The flat page holds a result no group renders; a grouped-only caller must
    // not pay to enrich it.
    expect(collectRenderedActivityIds(response, "grouped")).toEqual([A, B]);
  });

  it('"flat" scope collects only the flat page', () => {
    const response = makeResponse(
      [makeItem(A)],
      [makeGroup("dmcc", { topResults: [makeItem(A), makeItem(OFF_PAGE)] })]
    );
    expect(collectRenderedActivityIds(response, "flat")).toEqual([A]);
  });

  it('the default scope is the union of both views', () => {
    const response = makeResponse(
      [makeItem(A), makeItem(B)],
      [makeGroup("dmcc", { topResults: [makeItem(A)] })]
    );
    expect(collectRenderedActivityIds(response)).toEqual([A, B]);
    expect(collectRenderedActivityIds(response, "all")).toEqual(
      collectRenderedActivityIds(response)
    );
  });
});

describe("enrichResponse", () => {
  it("returns an entry for every rendered activity, so a lookup miss cannot happen", async () => {
    const response = makeResponse(
      [makeItem(A), makeItem(B)],
      [
        makeGroup("dmcc", { topResults: [makeItem(A)] }),
        makeGroup("adgm", { topResults: [makeItem(B)] }),
      ]
    );

    const summaries = await enrichResponse(response);

    expect(summaries.has(A)).toBe(true);
    expect(summaries.has(B)).toBe(true);
  });

  it("gives each activity its OWN summary, keyed by its own id", async () => {
    state.slot.approvals = [verifiedApproval(A)];
    state.slot.approval_fees = [
      { approvalId: "appr-1", amount: "15000", currency: "AED", feeType: "registration_fee" },
    ];
    state.slot.third_party_costs = [];

    const response = makeResponse(
      [makeItem(A), makeItem(B)],
      [
        makeGroup("dmcc", { topResults: [makeItem(A)] }),
        makeGroup("adgm", { topResults: [makeItem(B)] }),
      ]
    );

    const summaries = await enrichResponse(response);

    expect(summaries.get(A)!.verifiedApprovals).toHaveLength(1);
    expect(summaries.get(A)!.govFees[0]!.amount).toBe("15000");
    // B has no approvals of its own and must not inherit A's.
    expect(summaries.get(B)!.verifiedApprovals).toHaveLength(0);
    expect(summaries.get(B)!.govFees).toHaveLength(0);
  });

  it("does not enrich an activity that is not on the rendered page", async () => {
    state.slot.approvals = [verifiedApproval(OFF_PAGE)];
    state.slot.approval_fees = [
      { approvalId: "appr-1", amount: "15000", currency: "AED", feeType: "registration_fee" },
    ];
    state.slot.third_party_costs = [];

    // The flat page holds A and B; OFF_PAGE exists in neither view.
    const response = makeResponse(
      [makeItem(A), makeItem(B)],
      [
        makeGroup("dmcc", { topResults: [makeItem(A)] }),
        makeGroup("adgm", { topResults: [makeItem(B)] }),
      ]
    );

    const summaries = await enrichResponse(response);

    expect(summaries.has(OFF_PAGE)).toBe(false);
    expect(summaries.get(OFF_PAGE)).toBeUndefined();
  });

  it("an off-page activity cannot receive another activity's enrichment", async () => {
    state.slot.approvals = [verifiedApproval(A)];
    state.slot.approval_fees = [
      { approvalId: "appr-1", amount: "15000", currency: "AED", feeType: "registration_fee" },
    ];
    state.slot.third_party_costs = [];

    // Only A is rendered. B is a different activity that happens to be absent.
    const response = makeResponse(
      [makeItem(A)],
      [makeGroup("dmcc", { topResults: [makeItem(A)] })]
    );

    const summaries = await enrichResponse(response);

    expect(summaries.get(A)!.govFees).toHaveLength(1);
    expect(summaries.get(B)).toBeUndefined();
    expect(summaries.size).toBe(1);
  });

  it("batches the lookup — no per-activity queries", async () => {
    const items = Array.from({ length: 12 }, (_, i) => makeItem(`act-${i}`));
    const response = makeResponse(items, [makeGroup("dmcc", { topResults: items })]);

    await enrichResponse(response);

    // One query for approvals (+ two for the verified approvals' fees and
    // third-party costs, issued together). Never one per activity, so this
    // must not scale with the page size.
    expect(state.selectCount).toBeLessThanOrEqual(3);
  });

  it("query count does not grow with the number of activities", async () => {
    const few = Array.from({ length: 2 }, (_, i) => makeItem(`few-${i}`));
    const many = Array.from({ length: 40 }, (_, i) => makeItem(`many-${i}`));

    await enrichResponse(makeResponse(few, [makeGroup("dmcc", { topResults: few })]));
    const fewQueries = state.selectCount;

    state.clear();
    await enrichResponse(makeResponse(many, [makeGroup("dmcc", { topResults: many })]));
    const manyQueries = state.selectCount;

    expect(manyQueries).toBe(fewQueries);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The distinction that must survive: absent entry vs. empty summary
// ─────────────────────────────────────────────────────────────────────────────

describe("missing enrichment is not a regulatory finding", () => {
  it("an entry that exists but is empty means 'searched, nothing verified'", async () => {
    state.slot.approvals = [];
    state.slot.approval_fees = [];
    state.slot.third_party_costs = [];

    const summaries = await getRegulatorySummaries([A]);
    const s = summaries.get(A);

    expect(s).toBeDefined();
    expect(s!.verifiedApprovals).toHaveLength(0);
    expect(s!.govFees).toHaveLength(0);
  });

  it("an id that was never requested has no entry at all", async () => {
    const summaries = await getRegulatorySummaries([A]);
    expect(summaries.has(A)).toBe(true);
    expect(summaries.has(OFF_PAGE)).toBe(false);
  });

  it("a card with no summary does NOT claim 'not verified'", async () => {
    const rendered = await renderElement(
      SearchResultCard({ result: makeItem(A), summary: undefined })
    );

    expect(rendered.text).toContain("Not checked");
    expect(rendered.text).not.toContain("Not verified");
    expect(rendered.text).not.toContain("No approval required");
  });

  it("a card with an empty summary DOES report 'not verified' honestly", async () => {
    const rendered = await renderElement(
      SearchResultCard({ result: makeItem(A), summary: emptySummary() })
    );

    expect(rendered.text).toContain("Not verified/published in indexed official sources");
    expect(rendered.text).not.toContain("Not checked");
  });

  it("a card that was never enriched shows no fee or cost figure at all", async () => {
    const rendered = await renderElement(
      SearchResultCard({ result: makeItem(A), summary: undefined })
    );

    // No fabricated amounts, and no third-party cost invented from thin air.
    expect(rendered.text).not.toMatch(/AED\s*\d/);
    expect(rendered.text).not.toContain("Not verified");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Verified data still renders, and the existing semantics are untouched
// ─────────────────────────────────────────────────────────────────────────────

describe("verified data still renders", () => {
  it("renders verified data for a grouped result that the flat page did not contain", async () => {
    // This is the reported bug, end to end. The engine hands back a flat page and
    // a grouped view; a caller may draw from either. Before the fix, enrichment
    // was keyed on the flat page only, so this card — genuinely on screen —
    // received `undefined` and claimed "Not verified/published in indexed
    // official sources" for an activity that in fact HAS a verified fee.
    state.slot.approvals = [verifiedApproval(OFF_PAGE, "appr-off")];
    state.slot.approval_fees = [
      { approvalId: "appr-off", amount: "27500", currency: "AED", feeType: "registration_fee" },
    ];
    state.slot.third_party_costs = [];

    const response = makeResponse(
      [makeItem(A)],                                  // flat page: only A
      [makeGroup("dmcc", { topResults: [makeItem(OFF_PAGE)] })] // rendered: OFF_PAGE
    );

    const summaries = await enrichResponse(response);
    const card = await renderElement(
      SearchResultCard({ result: makeItem(OFF_PAGE), summary: summaries.get(OFF_PAGE) })
    );

    expect(card.text).toContain("Verified approval");
    expect(card.text).toContain("27,500");
    expect(card.text).not.toContain("Not verified/published");
    expect(card.text).not.toContain("Not checked");
  });

  it("shows a verified approval and its government fee", async () => {
    state.slot.approvals = [verifiedApproval(A)];
    state.slot.approval_fees = [
      { approvalId: "appr-1", amount: "15000", currency: "AED", feeType: "registration_fee" },
    ];
    state.slot.third_party_costs = [];

    const response = makeResponse([makeItem(A)], [makeGroup("dmcc", { topResults: [makeItem(A)] })]);
    const summaries = await enrichResponse(response);

    const rendered = await renderElement(
      SearchResultCard({ result: makeItem(A), summary: summaries.get(A) })
    );

    expect(rendered.text).toContain("Verified approval");
    expect(rendered.text).toContain("15,000");
    expect(rendered.text).toContain("registration fee");
  });

  it("keeps a third-party cost separate from the government fee", async () => {
    state.slot.approvals = [verifiedApproval(A)];
    state.slot.approval_fees = [
      { approvalId: "appr-1", amount: "15000", currency: "AED", feeType: "registration_fee" },
    ];
    state.slot.third_party_costs = [
      { approvalId: "appr-1", estimatedAmount: "25000", currency: "AED", costType: "technical_consultant" },
    ];

    const summaries = await getRegulatorySummaries([A]);
    const s = summaries.get(A)!;

    expect(s.govFees).toHaveLength(1);
    expect(s.thirdPartyCosts).toHaveLength(1);
    expect(s.govFees[0]!.amount).toBe("15000");
    expect(s.thirdPartyCosts[0]!.estimatedAmount).toBe("25000");
  });

  it("an approval signal is still shown as a signal, never as a verified approval", async () => {
    state.slot.approvals = [];
    state.slot.approval_fees = [];
    state.slot.third_party_costs = [];

    const summaries = await getRegulatorySummaries([A]);
    const rendered = await renderElement(
      SearchResultCard({
        result: makeItem(A, { approvalSignal: "third_party_approval_indicated" }),
        summary: summaries.get(A),
      })
    );

    expect(rendered.text).not.toContain("Verified approval");
    expect(rendered.text).toContain("Approval signal");
  });

  it("pending_review is never surfaced as verified", async () => {
    state.slot.approvals = [
      {
        id: "appr-p",
        activityId: A,
        name: "Pending approval",
        verificationStatus: "pending_review",
        authorityName: null,
        lastVerified: null,
      },
    ];
    state.slot.approval_fees = [
      { approvalId: "appr-p", amount: "9999", currency: "AED", feeType: "registration_fee" },
    ];
    state.slot.third_party_costs = [];

    const summaries = await getRegulatorySummaries([A]);
    const s = summaries.get(A)!;

    expect(s.verifiedApprovals).toHaveLength(0);
    expect(s.govFees).toHaveLength(0);

    const rendered = await renderElement(
      SearchResultCard({ result: makeItem(A), summary: s })
    );
    expect(rendered.text).not.toContain("Verified approval");
    expect(rendered.text).not.toContain("9,999");
  });

  it("unknown stays research-required rather than becoming a negative claim", async () => {
    state.slot.approvals = [];
    state.slot.approval_fees = [];
    state.slot.third_party_costs = [];

    const summaries = await getRegulatorySummaries([A]);
    const rendered = await renderElement(
      SearchResultCard({
        result: makeItem(A, { approvalSignal: "unknown", approvalStatus: "unknown" }),
        summary: summaries.get(A),
      })
    );

    expect(rendered.text).toContain("Research required");
    expect(rendered.text).not.toContain("No approval required");
    expect(rendered.text).not.toContain("Not required");
  });

  it("no match is reported as not found, never as prohibited", async () => {
    const summaries = await getRegulatorySummaries([]);
    expect(summaries.size).toBe(0);
    // The engine signals "no match" by omitting the activity entirely; the
    // availability strip carries that wording, never a prohibition claim.
    const response = makeResponse([], [makeGroup("adgm", { status: "no_match", totalMatches: 0, bestMatchType: null, topResults: [] })]);
    expect(response.availability.matchedJurisdictionSlugs).toEqual([]);
    expect(response.total).toBe(0);
  });
});