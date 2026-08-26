/**
 * Post-import data quality audit.
 * Runs the checks required by the platform's data rules and produces a
 * structured report with a transparent score.
 */

import { sql } from "drizzle-orm";
import type { DataQualityAudit } from "./types";

interface DbLike {
  unsafe<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
}

export async function auditJurisdiction(
  db: DbLike,
  jurisdictionSlug: string,
  sourceRecords: number,
  imported: number
): Promise<DataQualityAudit> {
  const j = await db.unsafe<{ id: string }>(
    `SELECT id FROM jurisdictions WHERE slug = $1 LIMIT 1`,
    [jurisdictionSlug]
  );
  if (j.length === 0) throw new Error(`Jurisdiction ${jurisdictionSlug} not found`);
  const jurisdictionId: string = j[0].id;

  interface TotalsRow { total: number; missing_code: number; missing_name: number; missing_description: number }
  const [totals] = await db.unsafe<TotalsRow>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE activity_code IS NULL)::int AS missing_code,
       COUNT(*) FILTER (WHERE official_name IS NULL OR official_name = '')::int AS missing_name,
       COUNT(*) FILTER (WHERE description IS NULL OR description = '')::int AS missing_description
     FROM activities WHERE jurisdiction_id = $1`,
    [jurisdictionId]
  );

  interface DupRow { dup_codes: number }
  const [dupes] = await db.unsafe<DupRow>(
    `SELECT
       COALESCE(SUM(c - 1), 0)::int AS dup_codes
     FROM (
       SELECT activity_code, COUNT(*) AS c FROM activities
       WHERE jurisdiction_id = $1 AND activity_code IS NOT NULL
       GROUP BY activity_code HAVING COUNT(*) > 1
     ) t`,
    [jurisdictionId]
  );

  interface DupNamesRow { dup_names: number }
  const [dupNames] = await db.unsafe<DupNamesRow>(
    `SELECT
       COALESCE(SUM(c - 1), 0)::int AS dup_names
     FROM (
       SELECT normalized_name, COUNT(*) AS c FROM activities
       WHERE jurisdiction_id = $1
       GROUP BY normalized_name HAVING COUNT(*) > 1
     ) t`,
    [jurisdictionId]
  );

  interface CountRow { n: number }
  const [badLic] = await db.unsafe<CountRow>(
    `SELECT COUNT(*)::int AS n FROM activities a
     LEFT JOIN licence_types lt ON lt.id = a.licence_type_id
     WHERE a.jurisdiction_id = $1 AND a.licence_type_id IS NOT NULL AND lt.id IS NULL`,
    [jurisdictionId]
  );

  interface LinkedRow { linked: number }
  const [srcLink] = await db.unsafe<LinkedRow>(
    `SELECT
       COUNT(DISTINCT a.id)::int AS linked
     FROM activities a
     WHERE a.jurisdiction_id = $1
       AND EXISTS (SELECT 1 FROM activity_sources asrc WHERE asrc.activity_id = a.id)`,
    [jurisdictionId]
  );

  interface HashRow { has_hash: boolean | null }
  const [srcHash] = await db.unsafe<HashRow>(
    `SELECT
       BOOL_OR(s.content_hash IS NOT NULL) AS has_hash
     FROM activity_sources asrc
     JOIN sources s ON s.id = asrc.source_id
     JOIN activities a ON a.id = asrc.activity_id
     WHERE a.jurisdiction_id = $1`,
    [jurisdictionId]
  );

  interface SignalRow { approval_signal: string; n: number }
  const signals = await db.unsafe<SignalRow>(
    `SELECT approval_signal, COUNT(*)::int AS n FROM activities
     WHERE jurisdiction_id = $1 GROUP BY approval_signal ORDER BY n DESC`,
    [jurisdictionId]
  );

  const [prices] = await db.unsafe<CountRow>(
    `SELECT COUNT(*)::int AS n
     FROM activity_source_prices p
     JOIN activities a ON a.id = p.activity_id
     WHERE a.jurisdiction_id = $1`,
    [jurisdictionId]
  );

  const total: number = totals.total;
  const signalMap: Record<string, number> = {};
  for (const r of signals) signalMap[r.approval_signal] = r.n;

  // ---- Transparent scoring -------------------------------------------------
  const nameScore = total === 0 ? 0 : 1;
  const codeScore = total === 0 ? 0 : 1 - totals.missing_code / total;         // weight 25%
  const descScore = total === 0 ? 0 : 1 - totals.missing_description / total;  // weight 15%
  const uniqScore =
    total === 0 ? 0 : Math.max(0, 1 - (dupes.dup_codes + dupNames.dup_names) / total); // 20%
  const linkScore =
    total === 0 ? 0 : srcLink.linked / total;                                  // 20%
  const integrityScore = badLic.n === 0 ? 1 : 0;                               // 10%
  const hashScore = srcHash.has_hash ? 1 : 0;                                  // 10%

  const scorePct = Math.round(
    (nameScore * 0 + codeScore * 0.25 + descScore * 0.15 + uniqScore * 0.2 +
      linkScore * 0.2 + integrityScore * 0.1 + hashScore * 0.1) * 100
  );

  return {
    totalActivities: total,
    missingCode: totals.missing_code,
    missingName: totals.missing_name,
    missingDescription: totals.missing_description,
    duplicateCodesInDb: dupes.dup_codes,
    duplicateNamesInDb: dupNames.dup_names,
    invalidLicenceRefs: badLic.n,
    sourceLinkedPct: total === 0 ? 0 : Math.round((srcLink.linked / total) * 100),
    rawHashRecorded: Boolean(srcHash.has_hash),
    approvalSignals: signalMap,
    pricesRecorded: prices.n,
    reconciliationDelta: sourceRecords - imported >= 0 ? sourceRecords - imported : sourceRecords - imported,
    scorePct,
  };
}

export function printAudit(a: DataQualityAudit): void {
  console.log("--- Data Quality Audit ---");
  console.log(`Activities in DB:      ${a.totalActivities}`);
  console.log(`Missing codes:         ${a.missingCode}`);
  console.log(`Missing names:         ${a.missingName}`);
  console.log(`Missing descriptions:  ${a.missingDescription}`);
  console.log(`Duplicate codes:       ${a.duplicateCodesInDb}`);
  console.log(`Duplicate names:       ${a.duplicateNamesInDb} (different codes → review, not merged)`);
  console.log(`Invalid licence refs:  ${a.invalidLicenceRefs}`);
  console.log(`Source-linked:         ${a.sourceLinkedPct}%`);
  console.log(`Raw hash recorded:     ${a.rawHashRecorded}`);
  console.log(`Approval signals:      ${JSON.stringify(a.approvalSignals)}`);
  console.log(`Prices recorded:       ${a.pricesRecorded}`);
  console.log(`Reconciliation delta:  ${a.reconciliationDelta}`);
  console.log(`QUALITY SCORE:         ${a.scorePct}%`);
}
