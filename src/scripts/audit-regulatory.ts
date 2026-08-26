/**
 * Phase 3 data-integrity audit.
 *
 * Checks the invariants required by the regulatory data rules and prints a
 * structured report. Exit code 1 if any CRITICAL check fails.
 *
 * Usage: npx tsx src/scripts/audit-regulatory.ts
 */
import "dotenv/config";

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

  await migrationClient.end();

  console.log("\n=== PHASE 3 DATA-INTEGRITY AUDIT ===");
  let failures = 0;
  for (const c of checks) {
    console.log(`[${c.status}] ${c.label}: ${c.value}`);
    if (c.status === "FAIL") failures += 1;
  }
  console.log(failures === 0 ? "\nRESULT: ALL CRITICAL CHECKS PASSED" : `\nRESULT: ${failures} CRITICAL FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
