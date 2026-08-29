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
    activityCode: string | null;
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
  totalMatches: number;
  bestMatchType: MatchType | null;
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
}
