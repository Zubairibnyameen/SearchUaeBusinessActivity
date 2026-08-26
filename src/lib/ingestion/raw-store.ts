/**
 * Raw source preservation.
 *
 * Every fetched payload is written to data/raw/<jurisdiction>/<date>/ with a
 * SHA-256 content hash and a JSON sidecar manifest. Existing files are NEVER
 * overwritten — a suffixed copy is created instead.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { DiscoveredSource, FetchedPayload, RawArtifact, SourceMetadata } from "./types";

function extensionFor(payload: FetchedPayload): string {
  const byFormat: Record<string, string> = {
    csv: ".csv",
    xlsx: ".xlsx",
    json: ".json",
    xml: ".xml",
    html: ".html",
    api: ".json",
  };
  if (payload.filename && /\.[a-z0-9]{2,5}$/i.test(payload.filename)) {
    return payload.filename.match(/\.[a-z0-9]{2,5}$/i)![0].toLowerCase();
  }
  return byFormat[payload.discovery.format] ?? ".bin";
}

export function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function saveRaw(
  meta: SourceMetadata,
  payload: FetchedPayload,
  seq: number
): RawArtifact {
  const dateDir = payload.fetchedAt.toISOString().split("T")[0];
  const dir = path.join(
    process.cwd(),
    "data",
    "raw",
    meta.jurisdictionSlug,
    dateDir
  );
  fs.mkdirSync(dir, { recursive: true });

  const base = `${payload.discovery.id}${seq > 1 ? `-${seq}` : ""}`;
  let filename = `${base}${extensionFor(payload)}`;
  let counter = 1;
  // Never overwrite an existing raw file.
  while (fs.existsSync(path.join(dir, filename))) {
    counter += 1;
    filename = `${base}-${Date.now()}-${counter}${extensionFor(payload)}`;
  }

  const abs = path.join(dir, filename);
  fs.writeFileSync(abs, payload.body);

  const hash = sha256(payload.body);
  const manifest = {
    file: filename,
    discoveryId: payload.discovery.id,
    label: payload.discovery.label,
    sourceUrl: payload.discovery.url,
    finalUrl: payload.finalUrl ?? payload.discovery.url,
    httpStatus: payload.httpStatus,
    contentType: payload.contentType,
    fetchedAt: payload.fetchedAt.toISOString(),
    bytes: payload.body.length,
    sha256: hash,
    jurisdiction: {
      slug: meta.jurisdictionSlug,
      name: meta.jurisdictionName,
      emirate: meta.emirate,
      type: meta.jurisdictionType,
      authority: meta.authorityName,
      authorityWebsite: meta.authorityWebsite,
      sourceType: meta.sourceType,
    },
    notes: payload.discovery.notes,
  };
  fs.writeFileSync(path.join(dir, `${filename}.manifest.json`), JSON.stringify(manifest, null, 2));

  return {
    relativePath: path.join("data", "raw", meta.jurisdictionSlug, dateDir, filename),
    absolutePath: abs,
    sha256: hash,
    bytes: payload.body.length,
  };
}
