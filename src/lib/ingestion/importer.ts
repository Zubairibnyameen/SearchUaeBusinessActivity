/**
 * Ingestion pipeline orchestrator.
 *
 * discover â†’ fetch â†’ preserve raw (hash) â†’ parse â†’ normalize â†’ validate
 *   â†’ dedupe â†’ import (transactional) â†’ audit â†’ report
 *
 * Guarantees:
 *  - raw payloads always preserved before parsing
 *  - no record is imported without a source link
 *  - within-batch code duplicates skipped; name collisions kept + flagged review
 *  - approval signals stored as signals, never as verified approvals
 *  - prices stored as source_activity_price, never merged into approval fees
 *  - imported rows land as PENDING REVIEW, never as verified regulatory facts
 *
 * Callers: `importWithDb` is the whole pipeline over a caller-supplied handle
 * (used by both the CLI and /admin/import). `runImport` is the CLI convenience
 * wrapper that opens its own connection.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and, isNull } from "drizzle-orm";
import { loadEnvFile } from "../db/env";
import {
  activities,
  activitySources,
  jurisdictions,
  licenceTypes,
  sources,
  activityApprovalSignals,
  activitySourcePrices,
  importReviewQueue,
} from "../db/schema";
import * as schemaTables from "../db/schema";
import { saveRaw } from "./raw-store";
import { detectBatchDuplicates, defaultValidate } from "./validate";
import { auditJurisdiction, printAudit } from "./audit";
import { formatAmount } from "./normalize";
import { hasSameSignal, planBackfill } from "./backfill";
import type { db as AppDatabase } from "../db";
import type {
  ImportReport,
  NormalizedActivity,
  OfficialActivitySourceAdapter,
} from "./types";

/** The pooled application client this pipeline is typed against. */
type ImportDatabase = typeof AppDatabase;

export interface ImportOptions {
  dryRun?: boolean;
  backfillSignals?: boolean;
  /** Progress sink. Omitted by the web workflow, which streams no console. */
  log?: (message: string) => void;
  /**
   * Optional post-import SQL data-quality audit. Needs a raw SQL handle, which
   * only the CLI client provides; the web workflow omits it and reports the
   * pipeline counters instead.
   */
  audit?: (
    jurisdictionSlug: string,
    sourceRecords: number,
    imported: number
  ) => Promise<ImportReport["audit"]>;
}

/**
 * The whole ingestion pipeline over a caller-supplied database handle.
 *
 * Everything the importer does â€” raw preservation, parsing, normalization,
 * validation, batch/DB de-duplication, the transactional write, and the
 * review-queue inserts â€” lives here, so the CLI and /admin/import share one
 * implementation rather than two that can drift apart.
 */
export async function importWithDb(
  db: ImportDatabase,
  adapter: OfficialActivitySourceAdapter,
  opts: ImportOptions = {}
): Promise<ImportReport> {
  const log = opts.log;

  const report: ImportReport = {
    adapter: adapter.meta.jurisdictionSlug,
    sourcesProcessed: [],
    artifacts: [],
    counters: {
      sourceRecords: 0,
      imported: 0,
      skippedInvalid: 0,
      duplicatesInBatch: 0,
      duplicatesExisting: 0,
      reviewFlagged: 0,
      backfilled: 0,
    },
    errors: [],
    warnings: [],
    reviewItems: [],
  };

  // ---------------------------------------------------------------
  // 1. Jurisdiction must exist (stub seeded beforehand)
  // ---------------------------------------------------------------
  const [jur] = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.slug, adapter.meta.jurisdictionSlug))
    .limit(1);
  if (!jur) throw new Error(`Jurisdiction '${adapter.meta.jurisdictionSlug}' not found in database`);

  const jurisdictionLicences = await db
    .select()
    .from(licenceTypes)
    .where(eq(licenceTypes.jurisdictionId, jur.id));

  // ---------------------------------------------------------------
  // 2. Discover + fetch + preserve raw
  // ---------------------------------------------------------------
  const discovered = await adapter.discover();
  log?.(`[${adapter.meta.jurisdictionSlug}] discovered ${discovered.length} source(s)`);

  let parsedRows: Awaited<ReturnType<typeof adapter.parse>> = [];
  let seq = 0;

  for (const d of discovered) {
    seq += 1;
    log?.(`  fetching ${d.id} (${d.format}) ... `);
    const payload = await adapter.fetch(d);
    if (payload.httpStatus && payload.httpStatus >= 400) {
      throw new Error(`HTTP ${payload.httpStatus} from ${d.url}`);
    }
    const artifact = saveRaw(adapter.meta, payload, seq);
    report.artifacts.push(artifact);
    report.sourcesProcessed.push(d);
    log?.(`saved ${artifact.bytes.toLocaleString()} bytes â†’ ${artifact.relativePath}`);
    log?.(`  sha256: ${artifact.sha256}`);

    const rows = await adapter.parse(payload);
    log?.(`  parsed ${rows.length} row(s)`);
    parsedRows = parsedRows.concat(rows);
  }

  report.counters.sourceRecords = parsedRows.length;

  // ---------------------------------------------------------------
  // 3. Normalize + validate
  // ---------------------------------------------------------------
  const normalized: NormalizedActivity[] = [];
  for (let i = 0; i < parsedRows.length; i++) {
    try {
      normalized.push(adapter.normalize(parsedRows[i]));
    } catch (err: unknown) {
      report.counters.skippedInvalid += 1;
      report.errors.push(
        `Row ${i}: normalize failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const issuesByIndex = new Map<number, ReturnType<typeof defaultValidate>>();
  normalized.forEach((n, i) => {
    const v = adapter.validate ? adapter.validate(n) : defaultValidate(n);
    const errors = v.filter((x) => x.severity === "error");
    if (errors.length > 0) {
      report.counters.skippedInvalid += 1;
      for (const e of errors) report.errors.push(`Row ${i}: ${e.message}`);
    } else {
      issuesByIndex.set(i, v);
      for (const w of v.filter((x) => x.severity === "review")) {
        // counted later per surviving row to avoid double counting
      }
    }
  });

  // ---------------------------------------------------------------
  // 4. Batch duplicate handling
  // ---------------------------------------------------------------
  const dupes = detectBatchDuplicates(normalized);
  const skipIndexes = new Set<number>(dupes.duplicateCodeIndexes);
  report.counters.duplicatesInBatch = dupes.duplicateCodeIndexes.length;

  const collisionSeen = new Set<string>();
  for (const c of dupes.reviewNameCollisions) {
    if (skipIndexes.has(c.indexA) || skipIndexes.has(c.indexB)) continue;
    const key = `${c.name}:${c.indexB}`;
    if (!collisionSeen.has(key)) {
      collisionSeen.add(key);
      report.counters.reviewFlagged += 1;
      report.reviewItems.push(
        `Same normalized name with different codes â€” kept both, requires review: "${c.name}" (rows ${c.indexA}/${c.indexB})`
      );
    }
  }

  // ---------------------------------------------------------------
  // 5. Import (single transaction per run)
  // ---------------------------------------------------------------
  if (!opts.dryRun) {
    const backfillSignals = opts.backfillSignals ?? false;
    await db.transaction(async (tx) => {
      const today = new Date().toISOString().split("T")[0];

      // One source record per fetched artifact. In backfill mode the source
      // is reused (idempotent) rather than duplicated on every run.
      const sourceIds: string[] = [];
      for (const art of report.artifacts) {
        const sourceUrl =
          report.sourcesProcessed.find((d) =>
            art.relativePath.includes(d.id)
          )?.url ?? adapter.meta.authorityWebsite ?? "";
        if (backfillSignals) {
          const [existing] = await tx
            .select({ id: sources.id, contentHash: sources.contentHash })
            .from(sources)
            .where(eq(sources.url, sourceUrl))
            .limit(1);
          if (existing) {
            // Reuse the source record; backfill missing content hash so
            // provenance is recorded for the verified artifact.
            if (!existing.contentHash) {
              await tx
                .update(sources)
                .set({ contentHash: art.sha256, lastVerified: today })
                .where(eq(sources.id, existing.id));
            }
            sourceIds.push(existing.id);
            continue;
          }
        }
        const [rec] = await tx
          .insert(sources)
          .values({
            url: sourceUrl,
            title: `${adapter.meta.jurisdictionName} official activities (${art.relativePath.split(/[\\/]/).pop()})`,
            sourceType: adapter.meta.sourceType,
            authority: adapter.meta.authorityName,
            retrievedDate: today,
            lastVerified: today,
            contentHash: art.sha256,
          })
          .returning({ id: sources.id });
        sourceIds.push(rec.id);
      }
      const primarySourceId = sourceIds[0];

      // Skipped batch duplicates are never silently discarded: the full
      // original row goes into the review queue with pending_review status.
      for (const i of [...skipIndexes].sort((a, b) => a - b)) {
        const n = normalized[i];
        await tx.insert(importReviewQueue).values({
          jurisdictionId: jur.id,
          discoveryId: report.sourcesProcessed[0]?.id,
          reason: "batch_duplicate_code",
          activityCode: n.activityCode ?? null,
          zone: n.zone ?? null,
          normalizedName: n.normalizedName ?? null,
          raw: n.raw,
        });
        report.reviewItems.push(
          `Batch-duplicate code queued for review (not imported): "${n.activityCode}" â€” "${n.officialName}"${n.zone ? ` [${n.zone}]` : ""} (source row ${i})`
        );
        report.counters.reviewFlagged += 1;
      }

      for (let i = 0; i < normalized.length; i++) {
        if (skipIndexes.has(i)) continue;
        if (!issuesByIndex.has(i)) continue; // invalid rows already reported

        const n = normalized[i];

        // Resolve licence type: prefer an exact-ish name match against the
        // jurisdiction's own licence types (source labels bind verbatim),
        // falling back to generic keyword â†’ canonical code heuristics.
        let licenceTypeId: string | null | undefined = undefined; // undefined = leave null
        if (n.licenceLabel) {
          const label = n.licenceLabel.toLowerCase();
          const byName = jurisdictionLicences.find((l) =>
            l.name.toLowerCase().includes(label.slice(0, 12))
          );
          let code: string | null = null;
          if (/industr/.test(label)) code = "IND";
          else if (/freelanc/.test(label)) code = "FRE";
          else if (/profession|service|consult/.test(label)) code = "PRO";
          else if (/commerc|trad/.test(label)) code = "COM";
          const byCode =
            code && jurisdictionLicences.find((l) => l.code === code);
          licenceTypeId = byName ? byName.id : byCode ? byCode.id : null;
        }

        // Identity within a jurisdiction = code (or normalized name) + zone.
        // RAKEZ publishes the same activity under Freezone AND Non-Freezone;
        // those are distinct catalog entries and both must be kept.
        const zoneFilter = n.zone
          ? eq(activities.zone, n.zone)
          : isNull(activities.zone);

        const existing = n.activityCode
          ? await tx
              .select({ id: activities.id })
              .from(activities)
              .where(
                and(
                  eq(activities.jurisdictionId, jur.id),
                  eq(activities.activityCode, n.activityCode),
                  zoneFilter
                )
              )
              .limit(1)
          : await tx
              .select({ id: activities.id })
              .from(activities)
              .where(
                and(
                  eq(activities.jurisdictionId, jur.id),
                  eq(activities.normalizedName, n.normalizedName),
                  zoneFilter
                )
              )
              .limit(1);

        if (existing.length > 0) {
          if (backfillSignals) {
            const [current] = await tx
              .select({
                approvalSignal: activities.approvalSignal,
                approvalStatus: activities.approvalStatus,
                verificationStatus: activities.verificationStatus,
              })
              .from(activities)
              .where(eq(activities.id, existing[0].id))
              .limit(1);

            if (!current) {
              // Row disappeared between lookup and update â€” skip safely.
              report.counters.duplicatesExisting += 1;
              continue;
            }

            const plan = planBackfill(current, n.signalDetail);

            if (plan.kind === "insert_signal" && plan.signalDetail) {
              const existingSignals = await tx
                .select({
                  signalType: activityApprovalSignals.signalType,
                  authorityName: activityApprovalSignals.authorityName,
                })
                .from(activityApprovalSignals)
                .where(eq(activityApprovalSignals.activityId, existing[0].id));

              let changed = false;
              if (
                !hasSameSignal(existingSignals, plan.signalDetail)
              ) {
                await tx.insert(activityApprovalSignals).values({
                  activityId: existing[0].id,
                  signalType: plan.signalDetail.signalType ?? "other_signal",
                  authorityName: plan.signalDetail.authorityName,
                  notes: plan.signalDetail.notes,
                  sourceId: primarySourceId,
                  lastVerified: today,
                });
                changed = true;
              }

              if (plan.needsSignalUpdate) {
                await tx
                  .update(activities)
                  .set({
                    approvalSignal: "third_party_approval_indicated",
                    ...(plan.patch?.approvalStatus !== undefined
                      ? { approvalStatus: plan.patch.approvalStatus }
                      : {}),
                    ...(plan.patch?.verificationStatus !== undefined
                      ? { verificationStatus: plan.patch.verificationStatus }
                      : {}),
                    lastVerified: today,
                  })
                  .where(eq(activities.id, existing[0].id));
                changed = true;
              } else if (plan.patch && Object.keys(plan.patch).length > 0) {
                await tx
                  .update(activities)
                  .set({
                    ...(plan.patch.approvalStatus !== undefined
                      ? { approvalStatus: plan.patch.approvalStatus }
                      : {}),
                    ...(plan.patch.verificationStatus !== undefined
                      ? { verificationStatus: plan.patch.verificationStatus }
                      : {}),
                    lastVerified: today,
                  })
                  .where(eq(activities.id, existing[0].id));
                changed = true;
              }

              if (changed) {
                report.counters.backfilled =
                  (report.counters.backfilled ?? 0) + 1;
              }
            } else if (plan.kind === "update_status" && plan.patch) {
              await tx
                .update(activities)
                .set({
                  ...(plan.patch.approvalStatus !== undefined
                    ? { approvalStatus: plan.patch.approvalStatus }
                    : {}),
                  ...(plan.patch.verificationStatus !== undefined
                    ? { verificationStatus: plan.patch.verificationStatus }
                    : {}),
                  lastVerified: today,
                })
                .where(eq(activities.id, existing[0].id));
              report.counters.backfilled =
                (report.counters.backfilled ?? 0) + 1;
            }
          } else {
            report.counters.duplicatesExisting += 1;
          }
          continue;
        }

        const [act] = await tx
          .insert(activities)
          .values({
            jurisdictionId: jur.id,
            licenceTypeId: licenceTypeId ?? null,
            activityCode: n.activityCode,
            officialName: n.officialName,
            normalizedName: n.normalizedName,
            description: n.description,
            officialCategory: n.officialCategory,
            normalizedCategory: n.normalizedCategory,
            activityGroup: n.activityGroup,
            activitySubcategory: n.activitySubcategory,
            officialNameAr: n.officialNameAr,
            isicCode: n.isicCode,
            zone: n.zone,
            restrictions: n.restrictions,
            approvalSignal: n.approvalSignal,
            sourceExtra: n.sourceExtra,
            // DATA-INTEGRITY RULE: a row that came from an official source is
            // SOURCE DATA, not a human-verified regulatory claim. The source
            // says the activity exists and what the authority publishes; it
            // does not attest that our reading of it was checked. So an
            // imported row lands as `pending_review` and a reviewer â€” not the
            // scraper â€” decides whether it is trustworthy.
            //
            // `lastVerified` is deliberately left NULL: it records that a
            // human confirmed this row, which has not happened yet. The
            // retrieval date lives on the `sources` row instead, where it
            // honestly describes the artifact.
            verificationStatus: "pending_review",
          })
          .returning({ id: activities.id });

        await tx.insert(activitySources).values({
          activityId: act.id,
          sourceId: primarySourceId,
          relevance: "primary",
        });

        if (n.signalDetail) {
          await tx.insert(activityApprovalSignals).values({
            activityId: act.id,
            signalType: n.signalDetail.signalType ?? "other_signal",
            authorityName: n.signalDetail.authorityName,
            notes: n.signalDetail.notes,
            sourceId: primarySourceId,
            lastVerified: today,
          });
        }

        const priceList =
          n.prices && n.prices.length > 0
            ? n.prices
            : n.price
              ? [n.price]
              : [];
        for (const p of priceList) {
          await tx.insert(activitySourcePrices).values({
            activityId: act.id,
            priceKind: "source_activity_price",
            amount: formatAmount(p.amount),
            currency: p.currency ?? "AED",
            conditions: p.conditions,
            sourceId: primarySourceId,
            retrievedDate: today,
            lastVerified: today,
          });
        }

        report.counters.imported += 1;
      }
    });
  } else {
    log?.("[DRY RUN] no database writes performed");
    report.counters.imported = normalized.length - skipIndexes.size - report.counters.skippedInvalid;
  }

  // ---------------------------------------------------------------
  // 6. Audit + report
  // ---------------------------------------------------------------
  if (!opts.dryRun && opts.audit) {
    report.audit = await opts.audit(
      adapter.meta.jurisdictionSlug,
      report.counters.sourceRecords,
      report.counters.imported
    );
  }
  return report;
}

/**
 * CLI entry point: opens a dedicated connection, streams progress to the
 * console, and runs the post-import SQL data-quality audit.
 *
 * The pipeline itself is `importWithDb`, which /admin/import also uses.
 */
export async function runImport(
  adapter: OfficialActivitySourceAdapter,
  opts: { dryRun?: boolean; backfillSignals?: boolean } = {}
): Promise<ImportReport> {
  loadEnvFile();
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  // Schema passed so this handle has the same type as the pooled app client.
  const db = drizzle(client, { schema: { ...schemaTables } });

  try {
    const report = await importWithDb(db, adapter, {
      dryRun: opts.dryRun,
      backfillSignals: opts.backfillSignals,
      log: message => console.log(message),
      audit: (slug, sourceRecords, imported) =>
        auditJurisdiction(client, slug, sourceRecords, imported),
    });

    console.log(`\n=== Import Report: ${adapter.meta.jurisdictionSlug.toUpperCase()} ===`);
    console.log(`Source records:       ${report.counters.sourceRecords}`);
    console.log(`Imported:             ${report.counters.imported}`);
    console.log(`Skipped (invalid):    ${report.counters.skippedInvalid}`);
    console.log(`Batch duplicates:     ${report.counters.duplicatesInBatch}`);
    console.log(`Existing duplicates:  ${report.counters.duplicatesExisting}`);
    console.log(`Review flagged:       ${report.counters.reviewFlagged}`);
    console.log(`Errors:               ${report.errors.length}`);
    if (report.audit) printAudit(report.audit);

    return report;
  } finally {
    await client.end();
  }
}
