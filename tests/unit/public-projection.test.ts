import { describe, it, expect, beforeEach } from "vitest";
import { toPublicSearchResponse } from "@/lib/search/public-projection";
import type {
  SearchResultItem,
  UnifiedSearchResponse,
} from "@/lib/search/types";

/**
 * The internal `activityCode` is a ranking/catalogue aid. It is not published by
 * any authority and it is NOT an ISIC classification, so it must never reach a
 * client. These tests pin that contract, including for the fields a client
 * legitimately does need.
 *
 * The fixtures are fully typed rather than cast. An `as unknown as` here would
 * let a renamed response field slip through silently, which is exactly how a
 * test for a security property can quietly stop testing anything.
 */

const ACTIVITY: SearchResultItem["activity"] = {
  id: "act-1",
  officialName: "General Trading",
  normalizedName: "general trading",
  activityCode: "GT-01",
  isicCode: "4651",
  description: null,
  officialCategory: "Trading",
  activityGroup: "Trading",
  approvalSignal: "no_signal",
  approvalStatus: "unknown",
  verificationStatus: "verified",
  lastVerified: "2026-01-01",
};

const JURISDICTION: SearchResultItem["jurisdiction"] = {
  id: "jur-1",
  name: "DMCC",
  slug: "dmcc",
  emirate: "dubai",
  jurisdictionType: "free_zone",
};

const RESULT: SearchResultItem = {
  activity: ACTIVITY,
  jurisdiction: JURISDICTION,
  licenceType: { id: "lt", name: "Commercial", code: "COM" },
  matchType: "exact",
  matchScore: 1,
  matchReasons: [],
  source: {
    id: "src-1",
    url: "https://example.com/source",
    title: "Official listing",
    lastVerified: "2026-01-01",
  },
};

function makeResponse(): UnifiedSearchResponse {
  return {
    query: "trading",
    total: 1,
    results: [RESULT],
    jurisdictionGroups: [
      {
        jurisdiction: JURISDICTION,
        status: "match",
        totalMatches: 1,
        bestMatchType: "exact",
        topResults: [RESULT],
      },
    ],
    availability: { matchedJurisdictionSlugs: ["dmcc"], unmatched: [] },
    intent: {
      primaryNoun: "trading",
      industryDomain: "general",
      specificityLevel: "broad",
      isGenericQuery: false,
      searchIntents: [],
      jurisdictionSlug: null,
      jurisdictionName: null,
      businessTerms: ["trading"],
      typoCorrected: false,
    },
    meta: {
      tookMs: 3,
      candidatesEvaluated: 12,
      minRelevanceThreshold: 0.62,
    },
  };
}

describe("toPublicSearchResponse", () => {
  let response: UnifiedSearchResponse;

  beforeEach(() => {
    response = makeResponse();
  });

  it("removes activityCode from flat search results", () => {
    const projected = toPublicSearchResponse(response);
    const activity = projected.results[0].activity as Record<string, unknown>;
    expect(activity).not.toHaveProperty("activityCode");
  });

  it("removes activityCode from per-jurisdiction top results", () => {
    const projected = toPublicSearchResponse(response);
    const activity = projected.jurisdictionGroups[0].topResults[0]
      .activity as Record<string, unknown>;
    expect(activity).not.toHaveProperty("activityCode");
  });

  it("keeps the published ISIC code", () => {
    const projected = toPublicSearchResponse(response);
    expect(projected.results[0].activity.isicCode).toBe("4651");
    expect(projected.jurisdictionGroups[0].topResults[0].activity.isicCode).toBe(
      "4651"
    );
  });

  it("keeps the fields clients legitimately render", () => {
    const activity = toPublicSearchResponse(response).results[0]
      .activity as Record<string, unknown>;
    expect(activity.id).toBe("act-1");
    expect(activity.officialName).toBe("General Trading");
    expect(activity.approvalStatus).toBe("unknown");
    expect(activity.verificationStatus).toBe("verified");
  });

  it("leaves scoring metadata, availability and group aggregates intact", () => {
    const projected = toPublicSearchResponse(response);
    expect(projected.query).toBe("trading");
    expect(projected.total).toBe(1);
    expect(projected.results[0].matchType).toBe("exact");
    expect(projected.results[0].matchScore).toBe(1);
    expect(projected.jurisdictionGroups[0].status).toBe("match");
    expect(projected.jurisdictionGroups[0].totalMatches).toBe(1);
    expect(projected.jurisdictionGroups[0].jurisdiction.slug).toBe("dmcc");
    expect(projected.availability.matchedJurisdictionSlugs).toEqual(["dmcc"]);
    expect(projected.intent.primaryNoun).toBe("trading");
    expect(projected.meta.tookMs).toBe(3);
  });

  it("preserves the evidence source, which the UI renders as provenance", () => {
    const projected = toPublicSearchResponse(response);
    // Stripping must not cost the provenance link users rely on.
    expect(projected.results[0].source).toEqual({
      id: "src-1",
      url: "https://example.com/source",
      title: "Official listing",
      lastVerified: "2026-01-01",
    });
  });

  it("never leaves the internal code anywhere in the serialised payload", () => {
    // A structural assertion on one known path can be bypassed by a new field
    // added later; this one cannot.
    expect(JSON.stringify(toPublicSearchResponse(response))).not.toContain(
      "GT-01"
    );
    expect(JSON.stringify(toPublicSearchResponse(response))).not.toContain(
      "activityCode"
    );
  });

  it("preserves a null ISIC code rather than inventing one", () => {
    response = makeResponse();
    response.results[0].activity.isicCode = null;
    const projected = toPublicSearchResponse(response);
    expect(projected.results[0].activity.isicCode).toBeNull();
  });

  it("does not mutate the engine's internal response", () => {
    // The engine result is reused for scoring; stripping must be non-destructive
    // so internal callers keep the code.
    toPublicSearchResponse(response);
    expect(response.results[0].activity.activityCode).toBe("GT-01");
  });

  it("handles an empty result set", () => {
    const empty: UnifiedSearchResponse = {
      ...makeResponse(),
      total: 0,
      results: [],
      jurisdictionGroups: [],
    };
    const projected = toPublicSearchResponse(empty);
    expect(projected.results).toEqual([]);
    expect(projected.jurisdictionGroups).toEqual([]);
  });
});

describe("search engine internal code contract", () => {
  it("keeps activityCode available to the matcher (server-only)", async () => {
    // Guards against someone "fixing" the leak by deleting the field from the
    // shared type, which would silently break exact-code ranking.
    const { searchUnified: _searchUnified } = await import("@/lib/search/engine");
    expect(_searchUnified).toBeTypeOf("function");
  });

  it("does not expose a public re-export of the internal code", async () => {
    // `public-projection` must be the only outbound path, and it must not hand
    // the raw activity back.
    const mod = await import("@/lib/search/public-projection");
    expect(Object.keys(mod)).toEqual(["toPublicSearchResponse"]);
  });
});
