/**
 * Automated relevance test suite — Phase 2 Step 2.
 *
 * Runs the 15 mandated business-idea queries against the unified search engine,
 * measures relevance (top-1/top-3), false-positive rate, jurisdiction coverage,
 * licence-binding integrity and approval-signal sanity, then writes a JSON
 * report under data/reports/search/.
 *
 * Usage: npx tsx src/scripts/test-search-relevance.ts
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const { searchUnified } = await import("../lib/search/engine");
  const { db } = await import("../lib/db");
  const { sql } = await import("drizzle-orm");

  interface QueryExpectation {
    query: string;
    expectAny: string[];
    minTotal: number;
  }

  const QUERIES: QueryExpectation[] = [
    { query: "digital marketing agency",     expectAny: ["marketing", "advertising", "promotional"], minTotal: 10 },
    { query: "software development company", expectAny: ["software", "programming", "computer"],     minTotal: 5 },
    { query: "restaurant",                   expectAny: ["restaurant", "catering", "food"],          minTotal: 5 },
    { query: "accounting consultancy",       expectAny: ["accounting", "bookkeeping", "accountancy"],minTotal: 3 },
    { query: "real estate brokerage",        expectAny: ["brokerage", "broker", "broking"],          minTotal: 3 },
    { query: "jewellery trading",            expectAny: ["jewellery", "jewelry", "gold", "precious"],minTotal: 10 },
    { query: "clothing trading",             expectAny: ["garment", "clothing", "apparel", "textile", "wearing"], minTotal: 10 },
    { query: "logistics company",            expectAny: ["logistics", "freight", "cargo", "shipping", "warehousing"], minTotal: 5 },
    { query: "medical clinic",               expectAny: ["clinic", "medical center", "medical centre"], minTotal: 3 },
    { query: "dental clinic",                expectAny: ["dental"],                                   minTotal: 2 },
    { query: "ecommerce business",           expectAny: ["e-commerce", "electronic", "online", "marketplace", "retail"], minTotal: 3 },
    { query: "online electronics store",     expectAny: ["electronic", "electrical", "computer", "online"], minTotal: 3 },
    { query: "advertising agency",           expectAny: ["advertising", "advertis", "promotional", "marketing"], minTotal: 5 },
    { query: "web development agency",       expectAny: ["web", "internet", "website", "design"],      minTotal: 3 },
    { query: "general trading",              expectAny: ["general trading"],                           minTotal: 3 },
  ];

  function textOf(item: { activity: { officialName: string; description: string | null } }): string {
    return `${item.activity.officialName} ${item.activity.description ?? ""}`.toLowerCase();
  }

  function isAutoRelevant(query: string, itemText: string): boolean {
    // Original words (length>2) minus generic suffixes must appear somewhere
    const words = query.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/)
      .filter(w => w.length > 2 && !["company", "agency", "business"].includes(w));
    return words.some(w => itemText.includes(w));
  }

  interface QueryResult {
    query: string;
    total: number;
    tookMs: number;
    candidatesEvaluated: number;
    jurisdictionsMatched: string[];
    jurisdictionsUnmatched: string[];
    top1Name: string | null;
    top1Type: string | null;
    top1Score: number | null;
    top1Relevant: boolean;
    top3Relevant: boolean;
    falsePositives: { id: string; name: string }[];
    pass: boolean;
    failures: string[];
  }

  const results: QueryResult[] = [];

  for (const exp of QUERIES) {
    const failures: string[] = [];
    const data = await searchUnified({ q: exp.query, limit: 20, groupLimit: 6 });

    if (data.total < exp.minTotal) {
      failures.push(`total ${data.total} < expected min ${exp.minTotal}`);
    }

    const top1 = data.results[0] ?? null;
    const top3 = data.results.slice(0, 3);
    const top1Text = top1 ? textOf(top1) : "";
    const top1Relevant = top1
      ? exp.expectAny.some(t => top1Text.includes(t)) || isAutoRelevant(exp.query, top1Text)
      : false;
    const top3Relevant = top3.some(r => {
      const t = textOf(r);
      return exp.expectAny.some(x => t.includes(x)) || isAutoRelevant(exp.query, t);
    });
    if (!top1Relevant) failures.push(`top-1 not relevant: "${top1?.activity.officialName}"`);
    if (!top3Relevant) failures.push("no relevant result in top-3");

    // False positive: result whose name+description contains NEITHER an expected
    // term NOR any original query word.
    const fps = data.results.filter(r => {
      const t = textOf(r);
      return !exp.expectAny.some(x => t.includes(x)) && !isAutoRelevant(exp.query, t);
    });
    if (fps.length > 0) {
      failures.push(`${fps.length} low-confidence/false-positive results (first: "${fps[0].activity.officialName}")`);
    }

    results.push({
      query: exp.query,
      total: data.total,
      tookMs: data.meta.tookMs,
      candidatesEvaluated: data.meta.candidatesEvaluated,
      jurisdictionsMatched: data.availability.matchedJurisdictionSlugs,
      jurisdictionsUnmatched: data.availability.unmatched.map(u => u.slug),
      top1Name: top1?.activity.officialName ?? null,
      top1Type: top1?.matchType ?? null,
      top1Score: top1?.matchScore ?? null,
      top1Relevant,
      top3Relevant,
      falsePositives: fps.slice(0, 5).map(f => ({
      id: f.activity.id,
      name: f.activity.officialName,
      matchType: f.matchType,
      score: f.matchScore,
      reason: f.matchReasons[0] ?? null,
    })),
      pass: failures.length === 0,
      failures,
    });
  }

  const firstRow = (res: unknown): Record<string, unknown> => {
    if (Array.isArray(res)) return res[0] ?? {};
    const r = res as { rows?: Record<string, unknown>[] };
    return r.rows?.[0] ?? {};
  };

  // Licence-binding integrity: every activity's licence type must belong to
  // the same jurisdiction as its activity.
  const licenceViolations = await db.execute(sql`
    SELECT COUNT(*)::int AS violations
    FROM activities a
    JOIN licence_types lt ON lt.id = a.licence_type_id
    WHERE lt.jurisdiction_id <> a.jurisdiction_id
  `);
  const violationCount = Number(firstRow(licenceViolations).violations ?? 0);

  // Approval-signal sanity: no NULL signals allowed.
  const badSignals = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM activities WHERE approval_signal IS NULL
  `);
  const badSignalCount = Number(firstRow(badSignals).n ?? 0);

  const totalQueries = results.length;
  const passed = results.filter(r => r.pass).length;
  const top1Rate = results.filter(r => r.top1Relevant).length / totalQueries;
  const top3Rate = results.filter(r => r.top3Relevant).length / totalQueries;
  const totalResults = results.reduce((s, r) => s + r.total, 0);
  const fpCounted = results.reduce((s, r) => s + r.falsePositives.length, 0);
  const fpRate = totalResults > 0 ? fpCounted / totalResults : 0;
  const avgTookMs = Math.round(results.reduce((s, r) => s + r.tookMs, 0) / totalQueries);
  const maxTookMs = Math.max(...results.map(r => r.tookMs));

  const summary = {
    generatedAt: new Date().toISOString(),
    datasetTotalsExpected: { dmcc: 1002, afz: 1689, spc: 1979, rakez: 3614, ifza: 825 },
    metrics: {
      queries: totalQueries,
      passRate: Math.round((passed / totalQueries) * 100),
      top1RelevanceRate: Math.round(top1Rate * 100),
      top3RelevanceRate: Math.round(top3Rate * 100),
      falsePositiveCount: fpCounted,
      falsePositiveRatePct: Math.round(fpRate * 10000) / 100,
      avgLatencyMs: avgTookMs,
      maxLatencyMs: maxTookMs,
      licenceBindingViolations: violationCount,
      nullApprovalSignals: badSignalCount,
    },
    perQuery: results,
  };

  const outDir = path.join(process.cwd(), "data", "reports", "search");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `relevance-test-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));

  console.log("=== SEARCH RELEVANCE TEST RESULTS ===");
  console.log(JSON.stringify(summary.metrics, null, 2));
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(
      `[${status}] "${r.query}" total=${r.total} top1=${r.top1Name} (${r.top1Type} ${r.top1Score}) jur=[${r.jurisdictionsMatched.join(",")}] ${r.tookMs}ms${r.failures.length ? ` :: ${r.failures.join("; ")}` : ""}`
    );
  }
  console.log(`Report written: ${outFile}`);
  process.exit(passed === totalQueries ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
