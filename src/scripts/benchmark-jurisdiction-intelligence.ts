/**
 * Jurisdiction Intelligence performance benchmark - STEP 7.
 *
 * Measures the added overhead of the jurisdiction intelligence layer vs the
 * base unified search, reusing the same retrieval data (searchUnified) and a
 * single batched regulatory-summary query.
 *
 * Usage: npx tsx src/scripts/benchmark-jurisdiction-intelligence.ts
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
  const { getJurisdictionIntelligence } = await import(
    "../lib/search/jurisdiction-intelligence"
  );

  // Warm-up
  await searchUnified({ q: "warm up query", limit: 5 });

  const RUNS = 5;
  interface Row {
    query: string;
    baseP50: number;
    intelP50: number;
    overheadMs: number;
    pctOverhead: number;
    matchedJurisdictions: number;
  }

  const rows: Row[] = [];

  for (const q of QUERIES) {
    const baseRuns: number[] = [];
    const intelRuns: number[] = [];
    let matchedJ = 0;

    for (let i = 0; i < RUNS; i++) {
      let t0 = performance.now();
      await searchUnified({ q, limit: 50 });
      baseRuns.push(performance.now() - t0);

      t0 = performance.now();
      const r = await getJurisdictionIntelligence(q);
      intelRuns.push(performance.now() - t0);
      matchedJ = r.meta.totalMatched;
    }

    const median = (arr: number[]) =>
      [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];

    const bp = median(baseRuns);
    const ip = median(intelRuns);
    rows.push({
      query: q,
      baseP50: Math.round(bp),
      intelP50: Math.round(ip),
      overheadMs: Math.round(ip - bp),
      pctOverhead: Math.round(((ip - bp) / bp) * 100),
      matchedJurisdictions: matchedJ,
    });
  }

  const avgBase = rows.reduce((s, r) => s + r.baseP50, 0) / rows.length;
  const avgIntel = rows.reduce((s, r) => s + r.intelP50, 0) / rows.length;

  const report = {
    generatedAt: new Date().toISOString(),
    runsPerQuery: RUNS,
    queries: rows,
    summary: {
      avgBaseP50Ms: Math.round(avgBase),
      avgIntelP50Ms: Math.round(avgIntel),
      avgOverheadMs: Math.round(avgIntel - avgBase),
      avgPctOverhead: Math.round(((avgIntel - avgBase) / avgBase) * 100),
    },
  };

  const outDir = path.join(process.cwd(), "data", "reports", "search");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(
    outDir,
    `jurisdiction-intelligence-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log("=== JURISDICTION INTELLIGENCE BENCHMARK ===");
  console.log(JSON.stringify(report.summary));
  for (const r of rows) {
    console.log(
      `  ${r.query.padEnd(32)} base=${r.baseP50}ms intel=${r.intelP50}ms overhead=${r.overheadMs}ms (${r.pctOverhead}%) matched=${r.matchedJurisdictions}`
    );
  }
  console.log(`\nReport written: ${out}`);
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
