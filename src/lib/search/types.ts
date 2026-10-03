/**
 * Shared search types. Pure type definitions only — safe to import
 * from both server code (engine, API routes) and client components.
 */

export type MatchType = "exact" | "strong" | "related" | "low_confidence" | "ai_suggestion";

export type SearchIntent =
  | "ACTIVITY_SEARCH"
  | "JURISDICTION_SEARCH"
  | "LICENCE_SEARCH"
  | "APPROVAL_SEARCH"
  | "FEE_SEARCH"
  | "COMPARISON_INTENT";

export type ApprovalSignalValue =
  | "no_signal"
  | "third_party_approval_indicated"
  | "may_be_required"
  | "restricted"
  | "unknown";

export interface BusinessIntent {
  primaryNoun: string;
  qualifiers: string[];
  industryDomain: string;
  requiredTerms: string[];
  excludedTerms: string[];
  isGenericQuery: boolean;
  specificityLevel: "broad" | "specific" | "very_specific";
}

export interface SearchResultItem {
  activity: {
    id: string;
    officialName: string;
    normalizedName: string;
    /**
     * INTERNAL jurisdiction-specific code. Retained because the matcher scores
     * exact code hits, but it is NOT rendered on any public surface — use
     * `isicCode` for anything a user can see.
     */
    activityCode: string | null;
    /** Published ISIC classification — the code safe to show publicly. */
    isicCode: string | null;
    description: string | null;
    officialCategory: string | null;
    activityGroup: string | null;
    approvalSignal: ApprovalSignalValue;
    approvalStatus: string;
    verificationStatus: string;
    lastVerified: string | null;
  };
  jurisdiction: {
    id: string;
    name: string;
    slug: string;
    emirate: string;
    jurisdictionType: string;
  };
  licenceType: {
    id: string;
    name: string;
    code: string | null;
  } | null;
  matchType: MatchType;
  matchScore: number;
  matchReasons: string[];
  source: {
    id: string;
    url: string;
    title: string;
    lastVerified: string | null;
  } | null;
}

export interface JurisdictionGroup {
  jurisdiction: {
    id: string;
    slug: string;
    name: string;
    emirate: string;
    jurisdictionType: string;
  };
  status: "match" | "no_match";
  /**
   * Number of matches for this jurisdiction across the WHOLE result set, not
   * just the current page. Stable across pages, so group ordering and the
   * availability strip do not shift as a user pages through results.
   */
  totalMatches: number;
  /**
   * Best match type across the whole result set for this jurisdiction, also
   * page-independent.
   */
  bestMatchType: MatchType | null;
  /**
   * The results this group actually renders: the subset of the requested page
   * (`offset`/`limit`, or every match when `allMatches` is set) that belongs to
   * this jurisdiction, capped at `groupLimit`.
   *
   * This is a partition of `UnifiedSearchResponse.results`, so the flat page and
   * the grouped view always describe the same slice. A group can legitimately be
   * empty on a given page while `status` is `"match"` — its matches simply rank
   * on other pages — so consumers must skip empty groups when rendering and use
   * `totalMatches` for availability.
   */
  topResults: SearchResultItem[];
}

export interface SearchAvailability {
  matchedJurisdictionSlugs: string[];
  unmatched: {
    id: string;
    slug: string;
    name: string;
    emirate: string;
    jurisdictionType: string;
  }[];
}

export interface UnifiedSearchResponse {
  query: string;
  total: number;
  results: SearchResultItem[];
  jurisdictionGroups: JurisdictionGroup[];
  availability: SearchAvailability;
  intent: {
    primaryNoun: string;
    industryDomain: string;
    specificityLevel: string;
    isGenericQuery: boolean;
    /** General search intent(s), strongest first, e.g. ["FEE_SEARCH","ACTIVITY_SEARCH"]. */
    searchIntents: SearchIntent[];
    /** Indexed jurisdiction mentioned in the query (results filtered to it). */
    jurisdictionSlug: string | null;
    jurisdictionName: string | null;
    /** Line-level understanding: the business words that drove the match. */
    businessTerms: string[];
    /** True when the raw query was changed by typo correction. */
    typoCorrected: boolean;
  };
  meta: {
    tookMs: number;
    candidatesEvaluated: number;
    minRelevanceThreshold: number;
  };
}

export interface SearchOptions {
  q: string;
  emirate?: string;
  jurisdictionType?: "mainland" | "free_zone";
  jurisdictionId?: string;
  approvalStatus?: string;
  licenceType?: string;
  verifiedOnly?: boolean;
  limit?: number;
  offset?: number;
  /** Max results shown per jurisdiction group in grouped view. */
  groupLimit?: number;
  /**
   * Opt out of paging: `results` and every group's `topResults` cover the whole
   * match set instead of one `offset`/`limit` window.
   *
   * For grouped-analysis callers — jurisdiction comparison, jurisdiction
   * intelligence — which summarise the best match per jurisdiction across all
   * matches rather than walking a page at a time. Free to use: the pipeline
   * already materialises the full ranked list, so paging is only a `slice`.
   *
   * Must NOT be used by paged UIs, which rely on `offset`/`limit` selecting the
   * rendered slice.
   */
  allMatches?: boolean;
}
