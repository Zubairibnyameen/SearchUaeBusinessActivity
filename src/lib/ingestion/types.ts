/**
 * Canonical ingestion types for official UAE activity sources.
 *
 * Every adapter implements OfficialActivitySourceAdapter:
 *   discover() → fetch() → [raw preserved] → parse() → normalize() → validate()
 */

export type SourceFormat = "csv" | "xlsx" | "json" | "xml" | "html" | "api";

export type SourceTypeEnum =
  | "federal_government"
  | "government_authority"
  | "mainland_authority"
  | "free_zone_authority"
  | "sector_regulator"
  | "government_pdf"
  | "secondary_source";

export type EmirateValue =
  | "dubai"
  | "abu_dhabi"
  | "sharjah"
  | "ajman"
  | "ras_al_khaimah"
  | "fujairah"
  | "umm_al_quwain";

export type JurisdictionTypeValue = "mainland" | "free_zone";

/** Canonical approval signal — a source indication, NOT a verified approval. */
export type ApprovalSignalValue =
  | "no_signal"
  | "third_party_approval_indicated"
  | "may_be_required"
  | "restricted"
  | "unknown";

export type ApprovalSignalTypeValue =
  | "third_party_authority_indicated"
  | "third_party_approval_required"
  | "restriction_noted"
  | "other_signal";

// ============================================================

export interface SourceMetadata {
  jurisdictionSlug: string;
  jurisdictionName: string;
  emirate: EmirateValue;
  jurisdictionType: JurisdictionTypeValue;
  authorityName: string;
  authorityWebsite?: string;
  /** source_type enum value for the sources table */
  sourceType: SourceTypeEnum;
}

export interface DiscoveredSource {
  /** Stable identifier within the adapter, e.g. "afz-activities-master". */
  id: string;
  label: string;
  url: string;
  format: SourceFormat;
  notes?: string;
}

export interface FetchedPayload {
  discovery: DiscoveredSource;
  body: Buffer;
  contentType?: string;
  filename?: string;
  fetchedAt: Date;
  httpStatus?: number;
  finalUrl?: string;
}

export interface RawArtifact {
  relativePath: string;
  absolutePath: string;
  sha256: string;
  bytes: number;
}

export interface ApprovalSignalData {
  signal: ApprovalSignalValue;
  signalType?: ApprovalSignalTypeValue;
  authorityName?: string;
  notes?: string;
}

export interface OfficialPriceData {
  amount: number;
  currency?: string;
  conditions?: string;
}

/** One row as parsed from the official source, before normalization. */
export interface ParsedActivity {
  /** Verbatim original row/record — always preserved. */
  raw: Record<string, unknown>;
  activityCode?: string;
  isicCode?: string;
  officialName: string;
  officialNameAr?: string;
  description?: string;
  officialCategory?: string;
  activityGroup?: string;
  activitySubcategory?: string;
  /** The source's own licence label, verbatim. */
  licenceLabel?: string;
  /** The source's own zone/sub-jurisdiction classification, verbatim (e.g. RAKEZ Freezone / Non-Freezone). */
  zone?: string;
  approval?: ApprovalSignalData;
  /** One or more official prices published for this activity (e.g. per licence category). */
  price?: OfficialPriceData;
  prices?: OfficialPriceData[];
  restrictions?: string;
  /** Any additional structured fields worth keeping beyond canonical columns. */
  extras?: Record<string, unknown>;
}

/** Canonical model ready for validation + import. */
export interface NormalizedActivity {
  activityCode?: string;
  isicCode?: string;
  officialName: string;
  normalizedName: string;
  officialNameAr?: string;
  description?: string;
  officialCategory?: string;
  normalizedCategory?: string;
  activityGroup?: string;
  activitySubcategory?: string;
  licenceLabel?: string;
  zone?: string;
  restrictions?: string;
  approvalSignal: ApprovalSignalValue;
  price?: OfficialPriceData;
  /** Additional official prices beyond `price` (never merged into approval fees). */
  prices?: OfficialPriceData[];
  signalDetail?: ApprovalSignalData;
  sourceExtra?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface ValidationIssue {
  severity: "error" | "warning" | "review";
  field?: string;
  message: string;
}

export interface OfficialActivitySourceAdapter {
  meta: SourceMetadata;
  discover(): Promise<DiscoveredSource[]>;
  fetch(source: DiscoveredSource): Promise<FetchedPayload>;
  parse(payload: FetchedPayload): Promise<ParsedActivity[]>;
  normalize(activity: ParsedActivity): NormalizedActivity;
  validate?(normalized: NormalizedActivity): ValidationIssue[];
}

// ============================================================
// Reports
// ============================================================

export interface ImportCounters {
  sourceRecords: number;
  imported: number;
  skippedInvalid: number;
  duplicatesInBatch: number;
  duplicatesExisting: number;
  reviewFlagged: number;
}

export interface ImportReport {
  adapter: string;
  sourcesProcessed: DiscoveredSource[];
  artifacts: RawArtifact[];
  counters: ImportCounters;
  errors: string[];
  warnings: string[];
  reviewItems: string[];
  audit?: DataQualityAudit;
}

export interface DataQualityAudit {
  totalActivities: number;
  missingCode: number;
  missingName: number;
  missingDescription: number;
  duplicateCodesInDb: number;
  duplicateNamesInDb: number;
  invalidLicenceRefs: number;
  sourceLinkedPct: number;
  rawHashRecorded: boolean;
  approvalSignals: Record<string, number>;
  pricesRecorded: number;
  reconciliationDelta: number; // sourceRecords - imported - skipped
  scorePct: number;
}
