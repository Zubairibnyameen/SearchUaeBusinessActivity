/**
 * Admin import orchestration.
 *
 * Validates the request, resolves the official adapter, and hands the bytes to
 * the existing ingestion pipeline (`importWithDb`). It adds no parsing, no
 * normalization and no writing of its own — the only thing it owns is deciding
 * whether an upload is acceptable and translating the pipeline's report into
 * something an admin can read.
 */

import { db } from "@/lib/db";
import { importWithDb } from "@/lib/ingestion/importer";
import { findImportableSource, IMPORTABLE_SOURCES } from "@/lib/ingestion/registry";
import {
  createUploadedSourceAdapter,
  formatForFilename,
  MAX_UPLOAD_BYTES,
  UploadValidationError,
  validateUpload,
  type UploadedFile,
} from "@/lib/ingestion/upload";

/** Largest number of individual messages shown in the UI. */
const MAX_LISTED_ERRORS = 20;
const MAX_LISTED_REVIEW_ITEMS = 20;

export class ImportRequestError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "ImportRequestError";
    this.field = field;
  }
}

export interface ImportSummary {
  slug: string;
  sourceLabel: string;
  authorityName: string;
  dryRun: boolean;
  rowsDiscovered: number;
  /** Rows written into `activities`. */
  rowsAccepted: number;
  /** Rows that failed validation and were not written. */
  rowsRejected: number;
  /** Rows that already exist in the database, so were not written again. */
  rowsSkippedDuplicate: number;
  /** Review-queue rows created by this run. */
  reviewItemsCreated: number;
  errors: string[];
  warnings: string[];
  reviewNotes: string[];
  /** Provenance of the preserved raw artifact, when one was written. */
  artifact: { relativePath: string; sha256: string; bytes: number } | null;
}

export interface RunAdminImportInput {
  /** The source slug chosen by the admin. */
  slug: string;
  file: UploadedFile | null;
  dryRun: boolean;
}

function cap(list: string[], max: number): string[] {
  return list.slice(0, max);
}

/**
 * Run one import from an uploaded official export.
 *
 * Rejects unknown sources, oversized files, and files whose extension does not
 * match what that source publishes — before the pipeline runs, so a bad request
 * never reaches the database or the filesystem.
 */
export async function runAdminImport(
  input: RunAdminImportInput
): Promise<ImportSummary> {
  try {
    return await importUpload(input);
  } catch (error) {
    // Only our own validation failures are safe to show: they describe the
    // request ("that file is too large"), never the server. Anything else — a
    // parser crash, a driver error, a connection string — is logged and reported
    // as a generic failure so nothing internal reaches the browser.
    if (error instanceof UploadValidationError) {
      throw new ImportRequestError(error.field, error.message);
    }
    if (error instanceof ImportRequestError) throw error;
    console.error("[admin] import pipeline failed:", error);
    throw new ImportRequestError(
      "file",
      "The import could not be completed. Try again, or check the source file."
    );
  }
}

async function importUpload(input: RunAdminImportInput): Promise<ImportSummary> {
  const slug = input.slug?.trim() ?? "";
  const source = findImportableSource(slug);
  if (!source) {
    throw new ImportRequestError(
      "slug",
      `That source is not supported. Choose one of: ${IMPORTABLE_SOURCES.map(s => s.slug).join(", ")}.`
    );
  }

  // Throws `UploadValidationError`, which the caller turns into a field error.
  const file = validateUpload(source, input.file);
  const format = formatForFilename(source.formats, file.filename);
  if (!format) {
    throw new ImportRequestError("file", "That file format is not supported for this source.");
  }

  const base = await source.load();
  const adapter = createUploadedSourceAdapter(base, file, format);
  const report = await importWithDb(db, adapter, { dryRun: input.dryRun });

  const artifact = report.artifacts[0] ?? null;

  return {
    slug: source.slug,
    sourceLabel: source.label,
    authorityName: source.authorityName,
    dryRun: input.dryRun,
    rowsDiscovered: report.counters.sourceRecords,
    rowsAccepted: report.counters.imported,
    rowsRejected: report.counters.skippedInvalid,
    rowsSkippedDuplicate:
      report.counters.duplicatesExisting + report.counters.duplicatesInBatch,
    reviewItemsCreated: report.counters.reviewFlagged,
    errors: cap(report.errors, MAX_LISTED_ERRORS),
    warnings: cap(report.warnings, MAX_LISTED_ERRORS),
    reviewNotes: cap(report.reviewItems, MAX_LISTED_REVIEW_ITEMS),
    artifact: artifact
      ? {
          relativePath: artifact.relativePath,
          sha256: artifact.sha256,
          bytes: artifact.bytes,
        }
      : null,
  };
}

export { MAX_UPLOAD_BYTES };