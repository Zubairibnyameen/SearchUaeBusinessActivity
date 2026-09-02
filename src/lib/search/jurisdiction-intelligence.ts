/**
 * Jurisdiction Intelligence Layer
 *
 * Deterministic jurisdiction-level analysis for a business activity query.
 * Uses existing database records ONLY. Never invents data.
 *
 * For each of the 5 indexed jurisdictions, reports:
 * - MATCH / NO_MATCH status
 * - Best actual matched activity (exact > strong > related)
 * - Licence type, activity code, approval signals
 * - Verified approval records (if any)
 * - Verified government fees (if any)
 * - Third-party cost records (if any)
 * - Source attribution and verification status
 */

import { searchUnified, type SearchOptions } from "./engine";
import { getRegulatorySummaries, type RegulatorySummary } from "./enrichment";
import type {
  SearchResultItem,
  MatchType,
  ApprovalSignalValue,
} from "./types";

// ============================================================
// TYPES
// ============================================================

export type JurisdictionMatchStatus = "MATCH" | "NO_MATCH";

export type LicenceBindingStatus = "verified" | "unknown";

export type ApprovalDisplayStatus =
  | "NO_ADDITIONAL_APPROVAL_VERIFIED"
  | "APPROVAL_SIGNAL_PRESENT"
  | "APPROVAL_VERIFIED"
  | "UNKNOWN_REQUIRES_RESEARCH"
  | "NOT_FOUND";

export type CostVerificationStatus = "verified" | "not_verified" | "not_published";

export interface LicenceIntelligence {
  officialActivityName: string;
  activityCode: string | null;
  licenceType: string | null;
  licenceBinding: LicenceBindingStatus;
  jurisdiction: string;
  jurisdictionSlug: string;
  activityCategory: string | null;
  restrictions: string | null;
  propertyRequirement: string | null;
  qualificationRequirement: string | null;
  minimumShareCapital: string | null;
  source: {
    id: string;
    url: string;
    title: string;
    lastVerified: string | null;
  } | null;
  verificationStatus: string;
  lastVerified: string | null;
}

export interface ApprovalIntelligence {
  displayStatus: ApprovalDisplayStatus;
  verifiedApprovals: {
    name: string;
    authorityName: string | null;
    approvalType: string;
    requirement: string | null;
    applicationProcess: string | null;
    source: {
      id: string;
      url: string;
      title: string;
    } | null;
    verificationStatus: string;
    lastVerified: string | null;
  }[];
  signals: {
    signalType: string;
    authorityName: string | null;
    notes: string | null;
    sourceId: string | null;
    lastVerified: string | null;
  }[];
  displayText: string;
}

export interface FeeIntelligence {
  governmentFees: {
    amount: string | number | null;
    currency: string;
    feeType: string;
    feeBasis: string;
    conditions: string | null;
    sourceId: string | null;
    lastVerified: string | null;
    verificationStatus: CostVerificationStatus;
  }[];
  thirdPartyCosts: {
    costType: string;
    description: string | null;
    estimatedAmount: string | number | null;
    currency: string;
    sourceId: string | null;
    verificationStatus: CostVerificationStatus;
  }[];
  sourceActivityPrices: {
    amount: string | number | null;
    currency: string;
    conditions: string | null;
    sourceId: string | null;
    lastVerified: string | null;
  }[];
  displayText: string;
}

export interface JurisdictionMatch {
  jurisdiction: {
    id: string;
    name: string;
    slug: string;
    emirate: string;
    jurisdictionType: string;
  };
  status: JurisdictionMatchStatus;
  reason: string;
  matchedActivities: SearchResultItem[];
  bestMatch: SearchResultItem | null;
  bestMatchType: MatchType | null;
  licenceIntelligence: LicenceIntelligence | null;
  approvalIntelligence: ApprovalIntelligence;
  feeIntelligence: FeeIntelligence;
  regulatorySummary: RegulatorySummary | null;
}

export interface JurisdictionIntelligenceResponse {
  query: string;
  intent: {
    primaryNoun: string;
    industryDomain: string;
    specificityLevel: string;
    isGenericQuery: boolean;
    searchIntents: string[];
    jurisdictionSlug: string | null;
    jurisdictionName: string | null;
    businessTerms: string[];
  };
  jurisdictions: JurisdictionMatch[];
  meta: {
    tookMs: number;
    totalMatched: number;
    totalUnmatched: number;
    indexedJurisdictions: number;
  };
}

// ============================================================
// HELPERS
// ============================================================

const MATCH_TYPE_PRIORITY: Record<MatchType, number> = {
  exact: 0,
  strong: 1,
  related: 2,
  low_confidence: 3,
  ai_suggestion: 4,
};

function pickBestMatch(items: SearchResultItem[]): SearchResultItem | null {
  if (items.length === 0) return null;
  return items.reduce((best, curr) => {
    const bestP = MATCH_TYPE_PRIORITY[best.matchType] ?? 99;
    const currP = MATCH_TYPE_PRIORITY[curr.matchType] ?? 99;
    if (currP < bestP) return curr;
    if (currP === bestP && curr.matchScore > best.matchScore) return curr;
    return best;
  });
}

function deriveLicenceBinding(
  item: SearchResultItem
): LicenceBindingStatus {
  if (item.licenceType) return "verified";
  return "unknown";
}

function deriveApprovalDisplayStatus(
  summary: RegulatorySummary | null,
  signal: ApprovalSignalValue,
  approvalStatus: string
): ApprovalDisplayStatus {
  if (summary && summary.verifiedApprovals.length > 0) {
    return "APPROVAL_VERIFIED";
  }
  if (signal === "third_party_approval_indicated" || signal === "may_be_required") {
    return "APPROVAL_SIGNAL_PRESENT";
  }
  if (signal === "restricted") {
    return "UNKNOWN_REQUIRES_RESEARCH";
  }
  if (approvalStatus === "no_additional_approval") {
    return "NO_ADDITIONAL_APPROVAL_VERIFIED";
  }
  return "UNKNOWN_REQUIRES_RESEARCH";
}

function approvalDisplayText(status: ApprovalDisplayStatus): string {
  switch (status) {
    case "NO_ADDITIONAL_APPROVAL_VERIFIED":
      return "No additional approval verified in indexed official data";
    case "APPROVAL_SIGNAL_PRESENT":
      return "Regulatory approval signal detected — verification pending";
    case "APPROVAL_VERIFIED":
      return "Approval verified in indexed official data";
    case "UNKNOWN_REQUIRES_RESEARCH":
      return "Unknown — requires research with the relevant authority";
    case "NOT_FOUND":
      return "Activity not found in indexed data";
  }
}

function feeDisplayText(
  govFees: FeeIntelligence["governmentFees"],
  tpc: FeeIntelligence["thirdPartyCosts"]
): string {
  const hasVerifiedFees = govFees.some(f => f.amount !== null && f.verificationStatus === "verified");
  const hasVerifiedTpc = tpc.some(t => t.estimatedAmount !== null && t.verificationStatus === "verified");

  if (hasVerifiedFees || hasVerifiedTpc) {
    return "Some fees verified in indexed official sources";
  }
  return "Government fees not verified/published in indexed official sources";
}

// ============================================================
// CORE FUNCTION
// ============================================================

export async function getJurisdictionIntelligence(
  query: string,
  options?: Partial<SearchOptions>
): Promise<JurisdictionIntelligenceResponse> {
  const startTime = Date.now();

  const searchData = await searchUnified({
    q: query,
    limit: 50,
    groupLimit: 10,
    ...options,
  });

  const matchedIds = [
    ...new Set(searchData.results.map(r => r.activity.id)),
  ];
  const regulatorySummaries = await getRegulatorySummaries(matchedIds);

  const jurisdictionMatches: JurisdictionMatch[] =
    searchData.jurisdictionGroups.map(group => {
      const summary =
        group.topResults[0]
          ? regulatorySummaries.get(group.topResults[0].activity.id) ?? null
          : null;

      if (group.status === "no_match") {
        return {
          jurisdiction: group.jurisdiction,
          status: "NO_MATCH" as const,
          reason:
            "No matching activity found in indexed official data",
          matchedActivities: [],
          bestMatch: null,
          bestMatchType: null,
          licenceIntelligence: null,
          approvalIntelligence: {
            displayStatus: "NOT_FOUND",
            verifiedApprovals: [],
            signals: [],
            displayText: "Activity not found in indexed data",
          },
          feeIntelligence: {
            governmentFees: [],
            thirdPartyCosts: [],
            sourceActivityPrices: [],
            displayText: "Activity not found in indexed data",
          },
          regulatorySummary: null,
        };
      }

      const best = pickBestMatch(group.topResults);
      const licence = best
        ? deriveLicenceIntelligence(best, group.jurisdiction)
        : null;
      const approval = deriveApprovalIntelligence(best, summary);
      const fees = deriveFeeIntelligence(summary);

      return {
        jurisdiction: group.jurisdiction,
        status: "MATCH" as const,
        reason: best
          ? `Matched in indexed official activity data — ${best.matchType} match`
          : "Match found but details unavailable",
        matchedActivities: group.topResults,
        bestMatch: best,
        bestMatchType: group.bestMatchType,
        licenceIntelligence: licence,
        approvalIntelligence: approval,
        feeIntelligence: fees,
        regulatorySummary: summary,
      };
    });

  const totalMatched = jurisdictionMatches.filter(
    j => j.status === "MATCH"
  ).length;
  const totalUnmatched = jurisdictionMatches.filter(
    j => j.status === "NO_MATCH"
  ).length;

  return {
    query: searchData.query,
    intent: {
      primaryNoun: searchData.intent.primaryNoun,
      industryDomain: searchData.intent.industryDomain,
      specificityLevel: searchData.intent.specificityLevel,
      isGenericQuery: searchData.intent.isGenericQuery,
      searchIntents: searchData.intent.searchIntents,
      jurisdictionSlug: searchData.intent.jurisdictionSlug,
      jurisdictionName: searchData.intent.jurisdictionName,
      businessTerms: searchData.intent.businessTerms,
    },
    jurisdictions: jurisdictionMatches,
    meta: {
      tookMs: Date.now() - startTime,
      totalMatched,
      totalUnmatched,
      indexedJurisdictions: jurisdictionMatches.length,
    },
  };
}

// ============================================================
// DERIVATION FUNCTIONS
// ============================================================

function deriveLicenceIntelligence(
  item: SearchResultItem,
  jurisdiction: {
    id: string;
    name: string;
    slug: string;
    emirate: string;
    jurisdictionType: string;
  }
): LicenceIntelligence {
  const raw =
    (item.activity as unknown as Record<string, unknown>).restrictions ??
    null;
  const restrictions =
    typeof raw === "string" ? raw : null;

  return {
    officialActivityName: item.activity.officialName,
    activityCode: item.activity.activityCode,
    licenceType: item.licenceType?.name ?? null,
    licenceBinding: deriveLicenceBinding(item),
    jurisdiction: jurisdiction.name,
    jurisdictionSlug: jurisdiction.slug,
    activityCategory: item.activity.officialCategory,
    restrictions,
    propertyRequirement: null,
    qualificationRequirement: null,
    minimumShareCapital: null,
    source: item.source
      ? {
          id: item.source.id,
          url: item.source.url,
          title: item.source.title,
          lastVerified: item.source.lastVerified,
        }
      : null,
    verificationStatus: item.activity.verificationStatus,
    lastVerified: item.activity.lastVerified,
  };
}

function deriveApprovalIntelligence(
  item: SearchResultItem | null,
  summary: RegulatorySummary | null
): ApprovalIntelligence {
  if (!item) {
    return {
      displayStatus: "NOT_FOUND",
      verifiedApprovals: [],
      signals: [],
      displayText: "Activity not found in indexed data",
    };
  }

  const verifiedApprovals = (summary?.verifiedApprovals ?? []).map(va => ({
    name: va.name,
    authorityName: va.authorityName,
    approvalType: "regulatory_permit" as const,
    requirement: null,
    applicationProcess: null,
    source: null,
    verificationStatus: "verified",
    lastVerified: va.lastVerified,
  }));

  const status = deriveApprovalDisplayStatus(
    summary,
    item.activity.approvalSignal,
    item.activity.approvalStatus
  );

  return {
    displayStatus: status,
    verifiedApprovals,
    signals: [],
    displayText: approvalDisplayText(status),
  };
}

function deriveFeeIntelligence(
  summary: RegulatorySummary | null
): FeeIntelligence {
  const governmentFees = (summary?.govFees ?? []).map(f => ({
    amount: f.amount,
    currency: f.currency,
    feeType: f.feeType,
    feeBasis: "fixed" as const,
    conditions: null,
    sourceId: null,
    lastVerified: null,
    verificationStatus: "verified" as const,
  }));

  const thirdPartyCosts = (summary?.thirdPartyCosts ?? []).map(tpc => ({
    costType: tpc.costType,
    description: null,
    estimatedAmount: tpc.estimatedAmount,
    currency: tpc.currency,
    sourceId: null,
    verificationStatus: "verified" as const,
  }));

  return {
    governmentFees,
    thirdPartyCosts,
    sourceActivityPrices: [],
    displayText: feeDisplayText(governmentFees, thirdPartyCosts),
  };
}

// ============================================================
// COMPARISON HELPERS
// ============================================================

export interface ComparisonDimension {
  label: string;
  values: Record<string, string | null>;
}

/**
 * Build comparison dimensions from jurisdiction matches.
 * Data-driven only — no artificial scoring or ranking.
 */
export function buildComparisonDimensions(
  matches: JurisdictionMatch[]
): ComparisonDimension[] {
  const dims: ComparisonDimension[] = [];

  dims.push({
    label: "Activity availability",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.status === "MATCH" ? "Matched in indexed official data" : "Not found in indexed data",
      ])
    ),
  });

  dims.push({
    label: "Match quality",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.bestMatchType
          ? m.bestMatchType.toUpperCase()
          : "N/A",
      ])
    ),
  });

  dims.push({
    label: "Official activity name",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.bestMatch?.activity.officialName ?? null,
      ])
    ),
  });

  dims.push({
    label: "Activity code",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.bestMatch?.activity.activityCode ?? "Not published",
      ])
    ),
  });

  dims.push({
    label: "Licence type",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.licenceIntelligence?.licenceType ?? "Not specified in source",
      ])
    ),
  });

  dims.push({
    label: "Restrictions",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.licenceIntelligence?.restrictions ?? "None published in indexed sources",
      ])
    ),
  });

  dims.push({
    label: "Property requirement",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.licenceIntelligence?.propertyRequirement ?? "Not verified",
      ])
    ),
  });

  dims.push({
    label: "Qualification requirement",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.licenceIntelligence?.qualificationRequirement ?? "Not verified",
      ])
    ),
  });

  dims.push({
    label: "Approval status",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.approvalIntelligence.displayText,
      ])
    ),
  });

  dims.push({
    label: "Verified approval authority",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.approvalIntelligence.verifiedApprovals.length > 0
          ? m.approvalIntelligence.verifiedApprovals
              .map(va => va.authorityName ?? va.name)
              .join(", ")
          : "Not verified",
      ])
    ),
  });

  dims.push({
    label: "Government approval fees",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.feeIntelligence.governmentFees.length > 0
          ? m.feeIntelligence.governmentFees
              .map(f =>
                f.amount !== null
                  ? `AED ${f.amount} (${f.feeType.replace(/_/g, " ")})`
                  : "Fee not verified"
              )
              .join("; ")
          : "Not verified/published in indexed official sources",
      ])
    ),
  });

  dims.push({
    label: "Third-party costs",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.feeIntelligence.thirdPartyCosts.length > 0
          ? m.feeIntelligence.thirdPartyCosts
              .map(tpc =>
                tpc.estimatedAmount !== null
                  ? `AED ${tpc.estimatedAmount} (${tpc.costType.replace(/_/g, " ")})`
                  : "Varies"
              )
              .join("; ")
          : "Not verified",
      ])
    ),
  });

  dims.push({
    label: "Source / verification",
    values: Object.fromEntries(
      matches.map(m => [
        m.jurisdiction.slug,
        m.licenceIntelligence?.source
          ? `${m.licenceIntelligence.source.title} (last verified: ${m.licenceIntelligence.source.lastVerified ?? "not recorded"})`
          : "Not verified",
      ])
    ),
  });

  return dims;
}

/**
 * Determine "best-supported matches" based on objective database evidence only.
 * Clearly labeled as based on indexed verified data — not professional advice.
 */
export function getBestSupportedMatches(
  matches: JurisdictionMatch[]
): {
  label: string;
  disclaimer: string;
  ranked: {
    jurisdiction: JurisdictionMatch["jurisdiction"];
    evidenceScore: number;
    evidenceFactors: string[];
  }[];
} {
  const ranked = matches
    .filter(m => m.status === "MATCH")
    .map(m => {
      let score = 0;
      const factors: string[] = [];

      if (m.bestMatchType === "exact") {
        score += 4;
        factors.push("exact match");
      } else if (m.bestMatchType === "strong") {
        score += 3;
        factors.push("strong match");
      } else if (m.bestMatchType === "related") {
        score += 2;
        factors.push("related match");
      }

      if (m.licenceIntelligence?.licenceType) {
        score += 1;
        factors.push("verified licence information");
      }
      if (m.approvalIntelligence.verifiedApprovals.length > 0) {
        score += 1;
        factors.push("verified approval information");
      }
      if (m.feeIntelligence.governmentFees.some(f => f.amount !== null)) {
        score += 1;
        factors.push("verified fee information");
      }

      return {
        jurisdiction: m.jurisdiction,
        evidenceScore: score,
        evidenceFactors: factors,
      };
    })
    .sort((a, b) => b.evidenceScore - a.evidenceScore);

  return {
    label: "Best-supported matches",
    disclaimer:
      "Based on indexed verified data — not professional, legal or business advice",
    ranked,
  };
}
