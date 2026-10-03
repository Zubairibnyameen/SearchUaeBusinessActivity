/**
 * File-backed adapters for admin uploads.
 *
 * The importer's contract is `discover() → fetch() → [raw preserved] → parse()`.
 * An admin uploading the official export is supplying the `fetch()` step by
 * hand, so instead of writing a second ingestion path we wrap the existing
 * adapter and override exactly those two methods. Everything downstream —
 * `parse()`, `normalize()`, `validate()`, validation, de-duplication, the
 * transactional write and the review-queue inserts — is the unchanged importer.
 *
 * That is the point: an upload is only a different way of *obtaining* the
 * bytes, never a different set of rules for interpreting them.
 */

import type {
  DiscoveredSource,
  FetchedPayload,
  OfficialActivitySourceAdapter,
  ParsedActivity,
  SourceFormat,
} from "./types";

/**
 * Refuse anything larger than this. The real source files are a few MB; a
 * multi-hundred-MB upload is a mistake or an attack, and parsing it would block
 * the request.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS: Record<SourceFormat, string> = {
  csv: ".csv",
  xlsx: ".xlsx",
  json: ".json",
  xml: ".xml",
  html: ".html",
  api: ".json",
};

/** Magic bytes for the formats we accept, so the extension cannot lie. */
const MAGIC_NUMBERS: Array<{ formats: SourceFormat[]; test: (b: Buffer) => boolean }> = [
  {
    // XLSX/XLS are zip containers: "PK\x03\x04".
    formats: ["xlsx"],
    test: b => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
];

export interface UploadedFile {
  filename: string;
  /** Bytes as handed over by the upload, already size-checked. */
  bytes: Buffer;
}

export class UploadValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "UploadValidationError";
    this.field = field;
  }
}

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(filename.trim());
  return match ? `.${match[1]!.toLowerCase()}` : "";
}

/**
 * Reject unsupported or malformed uploads BEFORE anything is written.
 *
 * Deliberately conservative: an extension must be one the chosen source
 * actually declares, and a binary format must match its magic bytes. A
 * mismatch is refused rather than "best effort" parsed, because a mis-selected
 * source would otherwise be recorded as if the authority had published it.
 */
export function validateUpload(
  source: { slug: string; formats: readonly SourceFormat[] },
  file: UploadedFile | null | undefined
): UploadedFile {
  if (!file || file.bytes.length === 0) {
    throw new UploadValidationError("file", "Choose a source file to upload.");
  }
  if (file.bytes.length > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      "file",
      `That file is too large (max ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`
    );
  }
  if (!file.filename || file.filename.length > 255) {
    throw new UploadValidationError("file", "That file name is not valid.");
  }

  const ext = extensionOf(file.filename);
  const accepted = source.formats
    .map(f => ACCEPTED_EXTENSIONS[f])
    .filter((e): e is string => Boolean(e));
  if (!accepted.includes(ext)) {
    throw new UploadValidationError(
      "file",
      `${source.slug} expects ${accepted.join(" or ")} — got ${ext || "a file with no extension"}.`
    );
  }

  for (const rule of MAGIC_NUMBERS) {
    if (rule.formats.some(f => ACCEPTED_EXTENSIONS[f] === ext) && !rule.test(file.bytes)) {
      throw new UploadValidationError(
        "file",
        "That file does not look like the format its extension claims."
      );
    }
  }

  return file;
}

/**
 * Wrap an official adapter so its bytes come from an upload instead of the
 * network, and tag the provenance so the preserved artifact and the `sources`
 * row record where the data actually came from.
 */
export function createUploadedSourceAdapter(
  base: OfficialActivitySourceAdapter,
  file: UploadedFile,
  format: SourceFormat
): OfficialActivitySourceAdapter {
  // `admin-upload` names the discovery in the raw manifest and in the review
  // queue, so an imported row can be traced to a human upload rather than to a
  // crawl that never happened.
  const source: DiscoveredSource = {
    id: "admin-upload",
    label: `Admin upload (${file.filename})`,
    url: base.meta.authorityWebsite ?? `upload://${base.meta.jurisdictionSlug}`,
    format,
    notes: "Bytes supplied by an authenticated admin upload, not fetched by the crawler.",
  };

  const payload: FetchedPayload = {
    discovery: source,
    body: file.bytes,
    filename: file.filename,
    fetchedAt: new Date(),
    // No HTTP: nothing was requested. Recorded as 200 so the importer's
    // ">= 400 is a failure" guard stays meaningful without faking a request.
    httpStatus: 200,
    finalUrl: source.url,
    contentType: extToContentType(format),
  };

  return {
    meta: base.meta,
    async discover(): Promise<DiscoveredSource[]> {
      return [source];
    },
    async fetch(): Promise<FetchedPayload> {
      return payload;
    },
    parse(p: FetchedPayload): Promise<ParsedActivity[]> {
      return base.parse(p);
    },
    normalize(activity: ParsedActivity) {
      return base.normalize(activity);
    },
    ...(base.validate ? { validate: base.validate } : {}),
  };
}

function extToContentType(format: SourceFormat): string {
  switch (format) {
    case "json":
    case "api":
      return "application/json; charset=utf-8";
    case "html":
      return "text/html; charset=utf-8";
    case "xml":
      return "application/xml; charset=utf-8";
    case "csv":
      return "text/csv; charset=utf-8";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
}

/** Which declared format an upload's extension corresponds to, if any. */
export function formatForFilename(
  formats: readonly SourceFormat[],
  filename: string
): SourceFormat | null {
  const ext = extensionOf(filename);
  return formats.find(f => ACCEPTED_EXTENSIONS[f] === ext) ?? null;
}