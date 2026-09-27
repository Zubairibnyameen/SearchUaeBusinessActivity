/**
 * Phase 3 data-integrity audit + STEP 15 data-completeness & coverage audit.
 *
 * Checks the invariants required by the regulatory data rules and prints a
 * structured report. Exit code 1 if any CRITICAL integrity check fails.
 *
 * Also emits a machine-readable coverage report (JSON) to
 * audit-reports/coverage-audit.json and a concise CLI summary.
 *
 * Usage: npx tsx src/scripts/audit-regulatory.ts
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildCoverageSummary,
  renderCliSummary,
  type JurisdictionCoverageRow,
  type ApprovalSignalByJurisdiction,
  type SignalTypeCount,
  type StatusCount,
  type ProvenanceRow,
  type CategoryRow,
} from "../lib/audit/coverage";

async function main() {
  const { migrationClient } = await import("../lib/db");

  const q = async (label: string, query: string, critical = false) => {
    const res = await migrationClient.unsafe(query);
    const rows = Array.isArray(res) ? res : [];
    const value = Number(Object.values(rows[0] ?? {})[0] ?? 0);
    const status = critical ? (value === 0 ? "PASS" : "FAIL") : "INFO";
    return { label, value, status };
  };

  const checks: Awaited<ReturnType<typeof q>>[] = [];

  // FK constraints present on every source_id column
  checks.push(
    await q(
      "source_id columns missing FK constraint",
      `SELECT count(*)::int FROM information_schema.columns c
       WHERE c.table_schema='public' AND c.column_name='source_id'
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
           WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name=c.table_name
             AND kcu.column_name='source_id')`,
      true
    )
  );

  // Orphans: regulatory records pointing at missing parents
  checks.push(await q("approvals with missing activity", `SELECT count(*)::int FROM approvals a LEFT JOIN activities ac ON ac.id=a.activity_id WHERE ac.id IS NULL`, true));
  checks.push(await q("approvals with non-null source_id not in sources", `SELECT count(*)::int FROM approvals ap LEFT JOIN sources s ON s.id=ap.source_id WHERE ap.source_id IS NOT NULL AND s.id IS NULL`, true));
  checks.push(await q("approval_fees with missing approval", `SELECT count(*)::int FROM approval_fees f LEFT JOIN approvals a ON a.id=f.approval_id WHERE a.id IS NULL`, true));
  checks.push(await q("third_party_costs with missing approval", `SELECT count(*)::int FROM third_party_costs t LEFT JOIN approvals a ON a.id=t.approval_id WHERE a.id IS NULL`, true));
  checks.push(await q("research queue items with missing activity", `SELECT count(*)::int FROM regulatory_research_queue r LEFT JOIN activities a ON a.id=r.activity_id WHERE a.id IS NULL`, true));

  // Verification discipline: VERIFIED claims must carry source + date
  checks.push(await q("VERIFIED approvals missing source", `SELECT count(*)::int FROM approvals WHERE verification_status='verified' AND source_id IS NULL`, true));
  checks.push(await q("VERIFIED approvals missing last_verified", `SELECT count(*)::int FROM approvals WHERE verification_status='verified' AND last_verified IS NULL`, true));
  checks.push(await q("approval fee rows missing source", `SELECT count(*)::int FROM approval_fees WHERE source_id IS NULL`, true));
  checks.push(await q("research items VERIFIED without verified_source", `SELECT count(*)::int FROM regulatory_research_queue WHERE research_status='verified' AND verified_source_id IS NULL`, true));
  checks.push(await q("research items VERIFIED without resolution approval", `SELECT count(*)::int FROM regulatory_research_queue WHERE research_status='verified' AND resolution_approval_id IS NULL`, true));

  // Fee separation: activity prices must never leak into approval fees
  checks.push(
    await q(
      "approval_fees whose amount equals the linked activity's source price (possible merge error)",
      `SELECT count(*)::int FROM approval_fees f
       JOIN approvals a ON a.id=f.approval_id
       JOIN activity_source_prices p ON p.activity_id=a.activity_id AND p.amount=f.amount`
    )
  );

  // Queue retention: nothing deleted
  checks.push(await q("regulatory_research_queue total items", `SELECT count(*)::int FROM regulatory_research_queue`));
  checks.push(await q("resolved queue items", `SELECT count(*)::int FROM regulatory_research_queue WHERE research_status IN ('verified','not_required')`));
  checks.push(await q("unresolved queue items retained", `SELECT count(*)::int FROM regulatory_research_queue WHERE research_status NOT IN ('verified','not_required')`));
  checks.push(await q("verification_history entries", `SELECT count(*)::int FROM verification_history`));
  checks.push(await q("admin audit log entries", `SELECT count(*)::int FROM admin_audit_logs`));

  const coverage = await runCoverage(migrationClient);

  const reportFile = join(process.cwd(), "audit-reports", "coverage-audit.json");
  await mkdir(join(process.cwd(), "audit-reports"), { recursive: true });
  await writeFile(reportFile, JSON.stringify(coverage, null, 2), "utf8");

  await migrationClient.end();

  console.log("\n=== PHASE 3 DATA-INTEGRITY AUDIT ===");
  let failures = 0;
  for (const c of checks) {
    console.log(`[${c.status}] ${c.label}: ${c.value}`);
    if (c.status === "FAIL") failures += 1;
  }
  console.log(failures === 0 ? "\nRESULT: ALL CRITICAL CHECKS PASSED" : `\nRESULT: ${failures} CRITICAL FAILURE(S)`);

  console.log("\n" + renderCliSummary(coverage));
  console.log(`\nMachine-readable report written to: ${reportFile}`);
  process.exit(failures === 0 ? 0 : 1);
}

interface CoverageClient {
  unsafe: (sql: string) => Promise<unknown[] | undefined>;
}

type Row = Record<string, unknown>;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function rows(client: CoverageClient, sql: string): Promise<Row[]> {
  const res = await client.unsafe(sql);
  return Array.isArray(res) ? (res as Row[]) : [];
}

/**
 * STEP 15 — data completeness & coverage audit.
 *
 * Efficient, read-only. Uses COUNT / COUNT DISTINCT / GROUP BY so the inner
 * joins (activity -> sources/signals/approvals/fees) can never multiply the
 * aggregate numbers. All joins are 1:N fans which are collapsed via the
 * DISTINCT keyed on the table's own primary key.
 */
async function runCoverage(client: CoverageClient) {
  const single = async (sql: string): Promise<number> => {
    const r = await rows(client, sql);
    return num(r[0] ? Object.values(r[0])[0] : 0);
  };

  const dataset: Record<string, number> = {
    activities: await single(`SELECT count(*)::int FROM activities`),
    sources: await single(`SELECT count(*)::int FROM sources`),
    activitySourceRows: await single(`SELECT count(*)::int FROM activity_sources`),
    activitySynonymRows: await single(`SELECT count(*)::int FROM activity_synonyms`),
    approvalSignalRows: await single(`SELECT count(*)::int FROM activity_approval_signals`),
    approvalRows: await single(`SELECT count(*)::int FROM approvals`),
    approvalFeeRows: await single(`SELECT count(*)::int FROM approval_fees`),
    thirdPartyCostRows: await single(`SELECT count(*)::int FROM third_party_costs`),
    researchQueueRows: await single(`SELECT count(*)::int FROM regulatory_research_queue`),
    verificationHistoryRows: await single(`SELECT count(*)::int FROM verification_history`),
  };
  const jcRows = await rows(
    client,
    `
    SELECT
      j.slug, j.name,
      COUNT(DISTINCT a.id)::int AS activities,
      COUNT(DISTINCT src.activity_id)::int AS activities_with_source,
      COUNT(DISTINCT sig.activity_id)::int AS activities_with_approval_signal,
      COUNT(DISTINCT ap.id)::int AS approval_records,
      COUNT(DISTINCT CASE WHEN ap.verification_status='verified' THEN ap.id END)::int AS verified_approval_records,
      COUNT(DISTINCT CASE WHEN ap.verification_status='verified' THEN a.id END)::int AS activities_with_verified_approval,
      COUNT(DISTINCT CASE WHEN f.id IS NOT NULL AND f.last_verified IS NOT NULL THEN f.id END)::int AS verified_fee_records,
      COUNT(DISTINCT CASE WHEN f.id IS NOT NULL AND f.last_verified IS NOT NULL THEN a.id END)::int AS activities_with_verified_fee,
      COUNT(DISTINCT tpc.id)::int AS third_party_cost_records
    FROM jurisdictions j
    LEFT JOIN activities a ON a.jurisdiction_id = j.id
    LEFT JOIN activity_sources src ON src.activity_id = a.id
    LEFT JOIN activity_approval_signals sig ON sig.activity_id = a.id
    LEFT JOIN approvals ap ON ap.activity_id = a.id
    LEFT JOIN approval_fees f ON f.approval_id = ap.id
    LEFT JOIN third_party_costs tpc ON tpc.approval_id = ap.id
    GROUP BY j.slug, j.name
    ORDER BY activities DESC
    `
  );
  const allJurisdictionCoverage = jcRows.map((r) => ({
    slug: String(r.slug),
    name: String(r.name),
    activities: num(r.activities),
    activitiesWithSource: num(r.activities_with_source),
    activitiesWithApprovalSignal: num(r.activities_with_approval_signal),
    approvalRecords: num(r.approval_records),
    verifiedApprovalRecords: num(r.verified_approval_records),
    activitiesWithVerifiedApproval: num(r.activities_with_verified_approval),
    verifiedFeeRecords: num(r.verified_fee_records),
    activitiesWithVerifiedFee: num(r.activities_with_verified_fee),
    thirdPartyCostRecords: num(r.third_party_cost_records),
  }));
  // Keep only jurisdictions that actually have indexed activities; empty
  // jurisdiction rows are placeholders (no indexed UAE coverage to claim).
  const jurisdictionCoverage: JurisdictionCoverageRow[] = allJurisdictionCoverage.filter((r) => r.activities > 0);
  const emptyJurisdictions = allJurisdictionCoverage.filter((r) => r.activities === 0).length;

  const signalJurRows = await rows(
    client,
    `SELECT a.approval_signal, j.slug, count(*)::int AS count
     FROM activities a JOIN jurisdictions j ON j.id=a.jurisdiction_id
     GROUP BY a.approval_signal, j.slug`
  );
  const approvalSignalByJurisdiction: ApprovalSignalByJurisdiction[] = signalJurRows.map((r) => ({
    slug: String(r.slug),
    approvalSignal: String(r.approval_signal),
    count: num(r.count),
  }));

  const signalTypeRows = await rows(
    client,
    `SELECT signal_type, count(*)::int AS count FROM activity_approval_signals GROUP BY signal_type`
  );
  const approvalSignalBySignalType: SignalTypeCount[] = signalTypeRows.map((r) => ({
    signalType: String(r.signal_type),
    count: num(r.count),
  }));

  const verifiedApprovalGlobal = {
    verifiedApprovalRecords: await single(
      `SELECT count(*)::int FROM approvals WHERE verification_status='verified'`
    ),
    activitiesWithVerifiedApproval: await single(
      `SELECT count(DISTINCT a.id)::int FROM approvals ap JOIN activities a ON a.id=ap.activity_id WHERE ap.verification_status='verified'`
    ),
  };

  const verifiedFeeProfile = {
    verifiedFeeRecords: await single(
      `SELECT count(*)::int FROM approval_fees WHERE last_verified IS NOT NULL`
    ),
    activitiesWithVerifiedFee: await single(
      `SELECT count(DISTINCT a.id)::int
       FROM approval_fees f
       JOIN approvals ap ON ap.id=f.approval_id
       JOIN activities a ON a.id=ap.activity_id
       WHERE f.last_verified IS NOT NULL`
    ),
  };

  const tpcRows = await rows(
    client,
    `SELECT j.slug, count(DISTINCT tpc.id)::int AS count
     FROM third_party_costs tpc
     JOIN approvals ap ON ap.id=tpc.approval_id
     JOIN activities a ON a.id=ap.activity_id
     JOIN jurisdictions j ON j.id=a.jurisdiction_id
     GROUP BY j.slug`
  );
  // third_party_costs has no verification_status column; provenance is the
  // best available proxy for a verified cost row (a linked official source).
  // This is objective: an empty table reports 0 without implying no costs exist.
  const verifiedTpcRecords = await single(
    `SELECT count(*)::int FROM third_party_costs WHERE source_id IS NOT NULL`
  );
  const thirdPartyCoverage = {
    totalRecords: dataset.thirdPartyCostRows,
    verifiedRecords: verifiedTpcRecords,
    byJurisdiction: tpcRows.map<StatusCount>((r) => ({ status: String(r.slug), count: num(r.count) })),
  };

  const provenance: ProvenanceRow[] = [
    { label: "verifiedApprovalMissingSource", count: await single(`SELECT count(*)::int FROM approvals WHERE verification_status='verified' AND source_id IS NULL`) },
    { label: "verifiedApprovalMissingLastVerified", count: await single(`SELECT count(*)::int FROM approvals WHERE verification_status='verified' AND last_verified IS NULL`) },
    { label: "verifiedApprovalSourceMissingContentHash", count: await single(`SELECT count(*)::int FROM approvals ap JOIN sources s ON s.id=ap.source_id WHERE ap.verification_status='verified' AND s.content_hash IS NULL`) },
    { label: "sourcesMissingContentHash", count: await single(`SELECT count(*)::int FROM sources WHERE content_hash IS NULL`) },
    { label: "sourcesMissingLastVerified", count: await single(`SELECT count(*)::int FROM sources WHERE last_verified IS NULL`) },
  ];

  const orphanChecks: Array<{ status: string; sql: string }> = [
    { status: "activitySourcesOrphanSourceId", sql: `SELECT count(*)::int FROM activity_sources s LEFT JOIN sources src ON src.id=s.source_id WHERE src.id IS NULL` },
    { status: "approvalFeesOrphanSourceId", sql: `SELECT count(*)::int FROM approval_fees f LEFT JOIN sources s ON s.id=f.source_id WHERE f.source_id IS NOT NULL AND s.id IS NULL` },
    { status: "thirdPartyCostsOrphanSourceId", sql: `SELECT count(*)::int FROM third_party_costs t LEFT JOIN sources s ON s.id=t.source_id WHERE t.source_id IS NOT NULL AND s.id IS NULL` },
    { status: "approvalSignalsOrphanSourceId", sql: `SELECT count(*)::int FROM activity_approval_signals sig LEFT JOIN sources s ON s.id=sig.source_id WHERE sig.source_id IS NOT NULL AND s.id IS NULL` },
    { status: "sourcePricesOrphanSourceId", sql: `SELECT count(*)::int FROM activity_source_prices p LEFT JOIN sources s ON s.id=p.source_id WHERE p.source_id IS NOT NULL AND s.id IS NULL` },
    { status: "licenceTypesOrphanSourceId", sql: `SELECT count(*)::int FROM licence_types lt LEFT JOIN sources s ON s.id=lt.source_id WHERE lt.source_id IS NOT NULL AND s.id IS NULL` },
    { status: "approvalsOrphanActivity", sql: `SELECT count(*)::int FROM approvals a LEFT JOIN activities ac ON ac.id=a.activity_id WHERE ac.id IS NULL` },
    { status: "approvalFeesOrphanApproval", sql: `SELECT count(*)::int FROM approval_fees f LEFT JOIN approvals ap ON ap.id=f.approval_id WHERE ap.id IS NULL` },
    { status: "thirdPartyCostsOrphanApproval", sql: `SELECT count(*)::int FROM third_party_costs t LEFT JOIN approvals ap ON ap.id=t.approval_id WHERE ap.id IS NULL` },
    { status: "researchQueueOrphanActivity", sql: `SELECT count(*)::int FROM regulatory_research_queue r LEFT JOIN activities a ON a.id=r.activity_id WHERE a.id IS NULL` },
    { status: "approvalSignalsOrphanActivity", sql: `SELECT count(*)::int FROM activity_approval_signals sig LEFT JOIN activities a ON a.id=sig.activity_id WHERE a.id IS NULL` },
    { status: "activitySourcesOrphanActivity", sql: `SELECT count(*)::int FROM activity_sources s LEFT JOIN activities a ON a.id=s.activity_id WHERE a.id IS NULL` },
  ];
  const orphans: StatusCount[] = [];
  for (const c of orphanChecks) {
    orphans.push({ status: c.status, count: await single(c.sql) });
  }

  const qStatusRows = await rows(
    client,
    `SELECT research_status, count(*)::int AS count FROM regulatory_research_queue GROUP BY research_status`
  );
  const qJurRows = await rows(
    client,
    `SELECT j.slug, count(*)::int AS count
     FROM regulatory_research_queue r LEFT JOIN jurisdictions j ON j.id=r.jurisdiction_id
     GROUP BY j.slug`
  );
  const researchQueue = {
    byStatus: qStatusRows.map<StatusCount>((r) => ({ status: String(r.research_status), count: num(r.count) })),
    byJurisdiction: qJurRows.map<StatusCount>((r) => ({ status: r.slug === null ? "unknown" : String(r.slug), count: num(r.count) })),
  };

  const catRows = await rows(
    client,
    `SELECT j.slug, a.official_category, count(*)::int AS count
     FROM activities a JOIN jurisdictions j ON j.id=a.jurisdiction_id
     GROUP BY j.slug, a.official_category
     ORDER BY count DESC`
  );
  const categoryDistribution: CategoryRow[] = catRows.map((r) => ({
    slug: String(r.slug),
    officialCategory: r.official_category === null ? null : String(r.official_category),
    count: num(r.count),
  }));

  const licencesMissing = await single(
    `SELECT count(*)::int FROM activities WHERE licence_type_id IS NULL`
  );

  return buildCoverageSummary({
    dataset,
    jurisdictionCoverage,
    emptyJurisdictionCount: emptyJurisdictions,
    approvalSignalByJurisdiction,
    approvalSignalBySignalType,
    verifiedApprovalGlobal,
    verifiedFeeProfile,
    thirdPartyCoverage,
    provenance,
    orphans,
    researchQueue,
    categoryDistribution,
    licencesMissing,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
