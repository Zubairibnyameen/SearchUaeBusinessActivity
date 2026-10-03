import { z } from "zod";

// ===== ENUMS =====

export const EmirateEnum = z.enum([
  "dubai",
  "abu_dhabi",
  "sharjah",
  "ajman",
  "ras_al_khaimah",
  "fujairah",
  "umm_al_quwain",
]);
export type Emirate = z.infer<typeof EmirateEnum>;

export const JurisdictionTypeEnum = z.enum(["mainland", "free_zone"]);
export type JurisdictionType = z.infer<typeof JurisdictionTypeEnum>;

export const ApprovalStatusEnum = z.enum([
  "no_additional_approval",
  "approval_required",
  "approval_may_be_required",
  "conditional_approval",
  "multiple_approvals_required",
  "restricted_activity",
  "not_permitted",
  "unknown",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusEnum>;

export const VerificationStatusEnum = z.enum([
  "verified",
  "pending_review",
  "outdated",
  "unverified",
  "conflict",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusEnum>;

export const MatchTypeEnum = z.enum([
  "exact",
  "strong",
  "related",
  "low_confidence",
  "ai_suggestion",
]);
export type MatchType = z.infer<typeof MatchTypeEnum>;

// Canonical search result shapes live in a dependency-free module so client
// components can import them without pulling in server code.
export type {
  ApprovalSignalValue,
  BusinessIntent,
  SearchResultItem,
  JurisdictionGroup,
  SearchAvailability,
  UnifiedSearchResponse,
} from "@/lib/search/types";
export type SearchResult = import("@/lib/search/types").SearchResultItem;

// ===== SEARCH =====

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  emirate: EmirateEnum.optional(),
  jurisdictionType: JurisdictionTypeEnum.optional(),
  jurisdictionId: z.string().uuid().optional(),
  approvalStatus: ApprovalStatusEnum.optional(),
  verifiedOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const CompareQuerySchema = z.object({
  activityId: z.string().uuid(),
  jurisdictionIds: z.array(z.string().uuid()).min(2).max(5),
});
export type CompareQuery = z.infer<typeof CompareQuerySchema>;

// ===== API RESPONSES =====

export interface ApprovalResult {
  id: string;
  name: string;
  approvalType: string;
  status: string;
  authority: {
    name: string;
    officialWebsite: string | null;
  } | null;
  description: string | null;
  conditions: unknown;
  requiredDocuments: unknown;
  inspectionRequired: boolean;
  nocRequired: boolean;
  lastVerified: string | null;
}

export interface FeeResult {
  id: string;
  feeType: string;
  amount: string | null;
  currency: string;
  feeBasis: string;
  isMandatory: boolean;
  conditions: string | null;
  lastVerified: string | null;
}

export interface ComparisonRow {
  jurisdiction: {
    id: string;
    name: string;
    slug: string;
    emirate: string;
    jurisdictionType: string;
  };
  activity: {
    id: string;
    officialName: string;
    /**
     * Published ISIC classification. The internal `activityCode` is an admin /
     * ranking field and is deliberately not part of this outbound type.
     */
    isicCode: string | null;
    approvalStatus: string;
    verificationStatus: string;
  } | null;
  licenceType: {
    name: string;
    code: string | null;
  } | null;
  approvals: ApprovalResult[];
  totalApprovalCost: number | null;
  totalRenewalCost: number | null;
  restrictions: string[];
  dataConfidence: "high" | "medium" | "low" | "none";
}

// ===== ADMIN =====

export const AdminActivitySchema = z.object({
  jurisdictionId: z.string().uuid(),
  licenceTypeId: z.string().uuid().optional(),
  activityCode: z.string().max(50).optional(),
  officialName: z.string().min(1).max(500),
  normalizedName: z.string().min(1).max(500),
  description: z.string().optional(),
  officialCategory: z.string().max(255).optional(),
  normalizedCategory: z.string().max(255).optional(),
  activityGroup: z.string().max(255).optional(),
  activitySubcategory: z.string().max(255).optional(),
  approvalStatus: ApprovalStatusEnum.default("unknown"),
  verificationStatus: VerificationStatusEnum.default("unverified"),
});
export type AdminActivityInput = z.infer<typeof AdminActivitySchema>;

export const AdminImportSchema = z.object({
  format: z.enum(["csv", "xlsx", "json"]),
  jurisdictionId: z.string().uuid(),
  data: z.array(z.record(z.string(), z.unknown())),
});
export type AdminImportInput = z.infer<typeof AdminImportSchema>;
