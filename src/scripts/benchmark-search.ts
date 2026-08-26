/**
 * Search performance benchmark - Phase 2 Step 7.
 *
 * Measures real query latency across representative queries (multiple runs),
 * then EXPLAIN ANALYZEs the heavy retrieval tiers so index decisions are
 * evidence-based.
 *
 * Usage: npx tsx src/scripts/benchmark-search.ts
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const QUERIES = [
  "digital marketing agency",
  "software development company",
  "restaurant",
  "jewellery trading",
  "general trading",
  "logistics services",
  "dental clinic",
  "ecommerce business",
];

async function main() {
  const { searchUnified } = await import("../lib/search/engine");
  const { migrationClient } = await import("../lib/db");

  // Warm-up (connection pool + planner caches)
  await searchUnified({ q: "warm up query", limit: 5 });

  interface QueryTiming {
    query: string;
    runs: number[];
    p50: number;
    p95: number;
    total: number;
    candidates: number;
  }

  const RUNS = 5;
  const timings: QueryTiming[] = [];

  for (const q of QUERIES) {
    const runs: number[] = [];
    let total = 0;
    let candidates = 0;
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const r = await searchUnified({ q, limit: 20 });
      const dt = performance.now() - t0;
      runs.push(Math.round(dt));
      total = r.total;
      candidates = r.meta.candidatesEvaluated;
    }
    const sorted = [...runs].sort((a, b) => a - b);
    timings.push({
      query: q,
      runs,
      p50: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      total,
      candidates,
    });
  }

  // EXPLAIN ANALYZE the three heaviest tier shapes
  const explains: Record<string, string> = {};
  const explainTargets: [string, string][] = [
    [
      "tier3_name_contains",
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT a.id FROM activities a
       WHERE a.normalized_name ILIKE '%marketing%'
       ORDER BY length(a.normalized_name) LIMIT 250`,
    ],
    [
      "tier6_category_group",
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT a.id FROM activities a
       WHERE a.official_category ILIKE '%marketing%'
          OR a.activity_group ILIKE '%marketing%'
          OR a.official_category ILIKE '%digital%'
          OR a.activity_group ILIKE '%digital%'
       LIMIT 150`,
    ],
    [
      "tier7_description",
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT a.id FROM activities a
       WHERE a.description ILIKE '%digital marketing%'
          OR a.description ILIKE '%marketing%'
       LIMIT 150`,
    ],
  ];

  for (const [label, stmt] of explainTargets) {
    try {
      const res = await migrationClient.unsafe(stmt);
      const rows = (res as unknown as { rows?: { [k: string]: unknown }[] });
      const lines = Array.isArray(rows)
        ? rows.map(r => Object.values(r)[0]).join("\n")
        : String(res);
      // Keep only the summary tail (execution time + strategy hints)
      const interesting = String(lines)
        .split("\n")
        .filter(l =>
          /Execution Time|Planning Time|Seq Scan|Bitmap|Index Scan|Rows Removed by Filter|rows=/.test(
            l
          )
        )
        .join("\n")
        .trim();
      explains[label] = interesting || String(lines).slice(0, 500);
    } catch (err) {
      explains[label] = `EXPLAIN failed: ${(err as Error).message}`;
    }
  }

  await migrationClient.end();

  const allP50s = timings.map(t => t.p50).sort((a, b) => a - b);
  const overallP50 = allP50s[Math.floor(allP50s.length / 2)];
  const overallMax = Math.max(...timings.map(t => t.p95));

  const report = {
    generatedAt: new Date().toISOString(),
    runsPerQuery: RUNS,
    datasetSize: 9109,
    queries: timings,
    summary: {
      overallP50Ms: overallP50,
      overallP95MaxMs: overallMax,
    },
    explainSummaries: explains,
    recommendationNotes:
      "Indexes are added only if these measurements justify them. See phase report.",
  };

  const outDir = path.join(process.cwd(), "data", "reports", "search");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log("=== SEARCH BENCHMARK ===");
  console.log(JSON.stringify(report.summary));
  for (const t of timings) {
    console.log(`  ${t.query.padEnd(32)} p50=${t.p50}ms p95=${t.p95}ms results=${t.total} candidates=${t.candidates}`);
  }
  for (const [k, v] of Object.entries(explains)) {
    console.log(`\n--- ${k} ---\n${v}`);
  }
  console.log(`\nReport written: ${out}`);
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
