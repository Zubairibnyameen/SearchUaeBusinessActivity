/**
 * STEP 6 — Search Intelligence live-DB metrics harness.
 *
 * Runs a battery of realistic queries against the unified search engine and
 * measures:
 *   - warm latency distribution (p50 / p95)
 *   - top-result strength for domain queries
 *   - jurisdiction-filter accuracy (zone-named queries return only that zone)
 *   - intent-flagging accuracy
 *   - typo-correction accuracy
 *   - empty-result honesty (intent-only / impossible / gibberish queries)
 *   - generic-query gating
 *
 * Usage: npx tsx src/scripts/test-search-metrics.ts
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

type IntentKind = "LICENCE_SEARCH" | "APPROVAL_SEARCH" | "FEE_SEARCH" | "COMPARISON_INTENT" | "JURISDICTION_SEARCH" | "ACTIVITY_SEARCH";

interface BatteryQuery {
  q: string;
  kind: "domain" | "jurisdiction" | "typo" | "intent" | "empty" | "generic";
  zone?: string;
  minTop?: "exact" | "strong" | "any";
  expectIntents?: IntentKind[];
  expectZero?: boolean;
  expectGeneric?: boolean;
}

const BATTERY: BatteryQuery[] = [
  // Domain queries — expect a strong/exact anchor in top position.
  { q: "restaurant", kind: "domain", minTop: "strong" },
  { q: "jewellery trading", kind: "domain", minTop: "strong" },
  { q: "medical clinic", kind: "domain", minTop: "strong" },
  { q: "logistics company", kind: "domain", minTop: "any" },
  { q: "car rental", kind: "domain", minTop: "strong" },
  { q: "online clothing store", kind: "domain", minTop: "strong" },
  { q: "ecommerce business", kind: "domain", minTop: "any" },
  { q: "accounting and bookkeeping", kind: "domain", minTop: "strong" },
  { q: "digital marketing agency", kind: "domain", minTop: "strong" },
  { q: "real estate brokerage", kind: "domain", minTop: "any" },
  { q: "training institute", kind: "domain", minTop: "any" },
  { q: "coffee shop", kind: "domain", minTop: "any" },
  { q: "cleaning services", kind: "domain", minTop: "any" },
  { q: "beauty salon", kind: "domain", minTop: "any" },

  // Jurisdiction-scoped queries — every result must be in the named zone.
  { q: "restaurant in RAKEZ", kind: "jurisdiction", zone: "rakez" },
  { q: "clinic in DMCC", kind: "jurisdiction", zone: "dmcc" },
  { q: "car rental ifza", kind: "jurisdiction", zone: "ifza" },
  { q: "logistics company SPC Free Zone", kind: "jurisdiction", zone: "spc" },
  { q: "brokerage in Ajman Free Zone", kind: "jurisdiction", zone: "afz" },

  // Typo queries — must correct and still return the right domain.
  { q: "jewlery trading", kind: "typo" },
  { q: "restarant in DMCC", kind: "typo", zone: "dmcc" },
  { q: "accountng firm", kind: "typo" },
  { q: "logistcs company", kind: "typo" },
  { q: "medcial clinic", kind: "typo" },

  // Intent queries — flag the right intent(s).
  { q: "how much is the licence fee for a restaurant in IFZA", kind: "intent", zone: "ifza", expectIntents: ["FEE_SEARCH", "LICENCE_SEARCH"] },
  { q: "do I need an approval to open a restaurant", kind: "intent", expectIntents: ["APPROVAL_SEARCH"] },
  { q: "what can I do in DMCC", kind: "intent", zone: "dmcc", expectIntents: ["JURISDICTION_SEARCH"] },
  { q: "compare RAKEZ and DMCC restaurant activities", kind: "intent", expectIntents: ["COMPARISON_INTENT"] },

  // Empty-result honesty — must return ZERO (no invented activities).
  { q: "how much does this approval cost", kind: "empty", expectZero: true },
  { q: "nuclear power plant", kind: "empty", expectZero: true },
  { q: "asdfqwer zxcv", kind: "empty", expectZero: true },

  // Generic gate — single generic words must be flagged generic.
  { q: "trading", kind: "generic", expectGeneric: true },
  { q: "consultancy", kind: "generic", expectGeneric: true },
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

interface RunResult {
  total: number;
  topName: string | null;
  topType: string | null;
  topScore: number | null;
  slugs: string[];
  intents: string[];
  typoCorrected: boolean;
  isGeneric: boolean;
  tookMs: number;
}

async function main() {
  const { searchUnified } = await import("../lib/search/engine");

  const records: (RunResult & { q: string; kind: BatteryQuery["kind"] })[] = [];
  const allLatencies: number[] = [];

  for (const b of BATTERY) {
    // warm-up (drops cold-start pages/indices)
    await searchUnified({ q: b.q, limit: 5, groupLimit: 4 });

    const runs: RunResult[] = [];
    for (let i = 0; i < 3; i++) {
      const data = await searchUnified({ q: b.q, limit: 5, groupLimit: 4 });
      const top = data.results[0] ?? null;
      runs.push({
        total: data.total,
        topName: top?.activity.officialName ?? null,
        topType: top?.matchType ?? null,
        topScore: top?.matchScore ?? null,
        slugs: data.results.map((r) => r.jurisdiction.slug),
        intents: data.intent.searchIntents,
        typoCorrected: data.intent.typoCorrected ?? false,
        isGeneric: data.intent.isGenericQuery,
        tookMs: data.meta.tookMs,
      });
      allLatencies.push(data.meta.tookMs);
    }
    const medianRun = runs.reduce((acc, r) => (r.tookMs < acc.tookMs ? r : acc), runs[0]);
    records.push({ ...medianRun, q: b.q, kind: b.kind });
  }

  const domain = records.filter((r) => r.kind === "domain");
  const jurisdiction = records.filter((r) => r.kind === "jurisdiction");
  const typos = records.filter((r) => r.kind === "typo");
  const intents = records.filter((r) => r.kind === "intent");
  const empties = records.filter((r) => r.kind === "empty");
  const generics = records.filter((r) => r.kind === "generic");

  const topExactStrong = domain.filter((r) => r.topType === "exact" || r.topType === "strong");
  const domainNoResults = domain.filter((r) => r.total === 0);

  const jurAllInZone = jurisdiction.filter((r) => {
    const zone = BATTERY.find((b) => b.q === r.q)!.zone!;
    return r.slugs.length > 0 && r.slugs.every((s) => s === zone);
  });

  const typoCorrected = typos.filter((r) => r.typoCorrected);
  const typoReturned = typos.filter((r) => r.total > 0);

  const intentOk = intents.filter((r) => {
    const want = BATTERY.find((b) => b.q === r.q)!.expectIntents!;
    return want.every((w) => r.intents.includes(w));
  });

  const emptyHonest = empties.filter((r) => r.total === 0);

  const genericOk = generics.filter((r) => r.isGeneric && r.total > 0);

  const latencies = [...allLatencies].sort((a, b) => a - b);
  const latencyP50 = percentile(latencies, 50);
  const latencyP95 = percentile(latencies, 95);

  const metrics = {
    generatedAt: new Date().toISOString(),
    queriesTotal: records.length,
    latencyMs: { p50: latencyP50, p95: latencyP95, sampleCount: latencies.length },
    domain: {
      queries: domain.length,
      top1ExactOrStrong: topExactStrong.length,
      top1ExactOrStrongRatePct: Math.round((topExactStrong.length / domain.length) * 100),
      zeroResultQueries: domainNoResults.map((r) => ({ q: r.q, total: r.total })),
    },
    jurisdiction: {
      queries: jurisdiction.length,
      allResultsWithinRequestedZone: jurAllInZone.length,
      zoneAccuracyPct: Math.round((jurAllInZone.length / jurisdiction.length) * 100),
      violations: jurisdiction
        .filter((r) => {
          const zone = BATTERY.find((b) => b.q === r.q)!.zone!;
          return r.slugs.length > 0 && r.slugs.some((s) => s !== zone);
        })
        .map((r) => ({ q: r.q, sawSlugs: [...new Set(r.slugs)] })),
    },
    typo: {
      queries: typos.length,
      flaggedCorrected: typoCorrected.length,
      returnedResults: typoReturned.length,
    },
    intent: {
      queries: intents.length,
      flaggedExpected: intentOk.length,
      intentAccuracyPct: Math.round((intentOk.length / intents.length) * 100),
    },
    emptyResults: {
      queries: empties.length,
      honestlyZero: emptyHonest.length,
    },
    generic: {
      queries: generics.length,
      flaggedGenericWithResults: genericOk.length,
    },
    perQuery: records,
  };

  const outDir = path.join(process.cwd(), "data", "reports", "search");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `metrics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(metrics, null, 2));

  console.log("=== STEP 6 SEARCH METRICS (live DB) ===");
  console.log(JSON.stringify({ ...metrics, perQuery: undefined }, null, 2));
  console.log("\n--- per query ---");
  for (const r of records) {
    console.log(
      `[${r.kind}] "${r.q}" total=${r.total} top=${r.topName} (${r.topType} ${r.topScore}) jur=[${[...new Set(r.slugs)].join(",")}] intent=[${r.intents.join(",")}] typo=${r.typoCorrected} generic=${r.isGeneric} ${r.tookMs}ms`,
    );
  }
  console.log(`\nReport written: ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});