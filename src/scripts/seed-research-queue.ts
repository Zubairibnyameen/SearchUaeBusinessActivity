/**
 * Seeds the regulatory research queue (Phase 3 Part 5 + Part 9).
 *
 * Prioritization model (documented weights):
 *   - existing third-party approval SIGNAL from the official source: 50
 *   - regulatory-risk/commercial-importance category match: 0-45
 *   - same activity name appearing in multiple jurisdictions: 10 per extra
 *     jurisdiction, capped at 30
 *   - user search frequency: reserved (analytics not implemented yet)
 *
 * Only a bounded top-N slice is queued — this is a WORKLIST, never a mass
 * generation of regulatory claims. No approval/fee/document data is created
 * here; every claim still requires authoritative verification.
 *
 * Idempotent: activities already present in the queue are skipped.
 *
 * Usage: npx tsx src/scripts/seed-research-queue.ts [limit=120]
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile } from "../lib/db/env";
import { assertDatabaseWritable } from "./db-safety";

loadEnvFile();

interface CategoryRule {
  label: string;
  weight: number;
  keywords: RegExp[];
}

/**
 * Research-priority categories per Phase 3 Part 9. Membership implies
 * RESEARCH PRIORITY ONLY — it is NEVER an assumption that approval is
 * actually required.
 */
const CATEGORY_RULES: CategoryRule[] = [
  { label: "financial services", weight: 45, keywords: [/\bbank/i, /\bfinanc/i, /\binsuranc/i, /\bforex\b/i, /money exchange|exchange house/i, /\bpayment\b|\bpayments\b/i, /\binvestment\b/i] },
  { label: "crypto / virtual assets", weight: 45, keywords: [/crypto/i, /virtual asset/i, /blockchain/i, /\bnft\b/i, /\btoken\b/i, /\bnft\b/i] },
  { label: "healthcare", weight: 40, keywords: [/\bmedic/i, /\bclinic/i, /\bhealth/i, /\bhospital/i, /\bdental/i, /pharmac/i, /\btherapy\b|therapies/i, /veterinary/i, /\bmedical\b/i] },
  { label: "education", weight: 35, keywords: [/educat/i, /\bschool/i, /train(ing|er)/i, /nursery/i, /kindergarten/i, /\binstitute/i, /academy/i, /\bchildcare\b|day ?care/i] },
  { label: "food", weight: 35, keywords: [/\bfood\b/i, /restaurant/i, /catering/i, /bakery/i, /\bcoffee\b|cafe\b/i, /cafeteria/i, /\bbutcher/i, /\bmeat\b/i, /\bfish\b(?!ing)/i, /\bjuice/i] },
  { label: "telecom", weight: 35, keywords: [/telecom/i, /broadcast(ing)?\b/i, /\bradio\b/i, /\bit\b.*(service|consult)/i] },
  { label: "security", weight: 30, keywords: [/security/i, /surveillance/i, /\bcctv\b/i, /\bguard(s|ing)?\b/i, /\balarm\b/i] },
  { label: "real estate", weight: 30, keywords: [/real estate/i, /brokerage/i, /property/i] },
  { label: "aviation", weight: 30, keywords: [/aviation/i, /airline/i, /aircraft/i, /drone/i, /helicopter/i, /air ?cargo/i] },
  { label: "cosmetics", weight: 25, keywords: [/cosmetic/i, /\bbeauty\b/i, /salon/i, /perfume/i, /\bspa\b/i] },
  { label: "marine", weight: 25, keywords: [/marine/i, /maritime/i, /vessel/i, /yacht/i, /\bboat(s)?\b/i, /\bport\b.*service/i] },
  { label: "transportation", weight: 25, keywords: [/transport/i, /\btaxi\b/i, /limousine/i, /car rental|vehicle rental/i, /\bdriving\b.*school/i] },
  { label: "professional regulated services", weight: 20, keywords: [/\blegal\b/i, /\blaw(yer| firm)?\b/i, /account(ing|ancy)/i, /\baudit/i, /engineering consult/i] },
  { label: "logistics", weight: 20, keywords: [/logistic/i, /freight/i, /customs clearance/i, /warehous/i, /\bcourier\b/i, /delivery service/i] },
  { label: "industrial/manufacturing", weight: 15, keywords: [/manufactur/i, /factor(y|ies)\b/i, /\bindustr/i, /\bassembly\b/i] },
  { label: "media", weight: 15, keywords: [/\bmedia\b/i, /advertis/i, /publishing/i, /production/i] },
];

async function main() {
  assertDatabaseWritable("seed-research-queue");
  const limit = Number(process.argv[2]) || 120;
  const { db } = await import("../lib/db");
  const {
    activities,
    jurisdictions,
    activityApprovalSignals,
    regulatoryResearchQueue,
  } = await import("../lib/db/schema");
  const { eq, sql, notInArray } = await import("drizzle-orm");

  // Activities already queued (idempotent re-runs)
  const queued = await db
    .select({ id: regulatoryResearchQueue.activityId })
    .from(regulatoryResearchQueue);
  const queuedIds = queued.map((q) => q.id);

  // Candidate pool: activities with an explicit third-party approval SIGNAL
  // from their official free-zone source. 'unknown' signals are NOT queued
  // en masse (that would be ~1k speculative rows) — they enter via manual
  // admin addition when a concrete lead exists.
  const baseWhere = eq(activities.approvalSignal, "third_party_approval_indicated");
  const candidates = await db
    .select({
      id: activities.id,
      code: activities.activityCode,
      name: activities.normalizedName,
      officialName: activities.officialName,
      category: activities.officialCategory,
      group: activities.activityGroup,
      jurisdictionId: activities.jurisdictionId,
      jurisdictionSlug: jurisdictions.slug,
      signal: activities.approvalSignal,
    })
    .from(activities)
    .innerJoin(jurisdictions, eq(jurisdictions.id, activities.jurisdictionId))
    .where(
      queuedIds.length > 0
        ? sql`${baseWhere} AND ${notInArray(activities.id, queuedIds)}`
        : baseWhere
    );

  // Cross-jurisdiction occurrence count by normalized name
  const nameCounts = await db
    .select({ name: activities.normalizedName, n: sql<number>`count(distinct ${activities.jurisdictionId})::int` })
    .from(activities)
    .groupBy(activities.normalizedName);
  const nameCountMap = new Map(nameCounts.map((r) => [r.name, r.n]));

  // Named authorities captured in structured signal rows
  const authorityRows = await db
    .select({
      activityId: activityApprovalSignals.activityId,
      authorityName: activityApprovalSignals.authorityName,
    })
    .from(activityApprovalSignals)
    .where(sql`${activityApprovalSignals.authorityName} IS NOT NULL`);
  const authorityMap = new Map<string, string>();
  for (const r of authorityRows) {
    if (!authorityMap.has(r.activityId)) authorityMap.set(r.activityId, r.authorityName!);
  }

  interface Scored {
    id: string;
    code: string | null;
    jurisdictionId: string;
    slug: string;
    score: number;
    reasons: { factor: string; points: number }[];
    categoryLabel: string | null;
  }

  const scored: Scored[] = [];
  for (const c of candidates) {
    let score = 0;
    const reasons: { factor: string; points: number }[] = [];

    score += 50;
    reasons.push({ factor: "third-party approval signal in official source", points: 50 });

    const hay = `${c.officialName} ${c.category ?? ""} ${c.group ?? ""}`;
    let matchedCategory: CategoryRule | null = null;
    for (const rule of CATEGORY_RULES) {
      if (rule.keywords.some((k) => k.test(hay))) {
        if (!matchedCategory || rule.weight > matchedCategory.weight) matchedCategory = rule;
      }
    }
    if (matchedCategory) {
      score += matchedCategory.weight;
      reasons.push({ factor: `priority category: ${matchedCategory.label}`, points: matchedCategory.weight });
    }

    const jc = nameCountMap.get(c.name) ?? 1;
    if (jc > 1) {
      const pts = Math.min(3, jc - 1) * 10;
      score += pts;
      reasons.push({ factor: `same normalized activity in ${jc} indexed jurisdictions`, points: pts });
    }

    scored.push({
      id: c.id,
      code: c.code,
      jurisdictionId: c.jurisdictionId,
      slug: c.jurisdictionSlug,
      score,
      reasons,
      categoryLabel: matchedCategory?.label ?? null,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, limit);

  let inserted = 0;
  for (const s of selected) {
    await db.insert(regulatoryResearchQueue).values({
      activityId: s.id,
      activityCode: s.code,
      jurisdictionId: s.jurisdictionId,
      approvalSignal: "third_party_approval_indicated",
      possibleAuthority: authorityMap.get(s.id) ?? null,
      priorityScore: s.score,
      priorityReasons: s.reasons,
      notes: `Auto-queued by priority seeding (${s.slug}${s.categoryLabel ? ` · ${s.categoryLabel}` : ""}).`,
    });
    inserted += 1;
  }

  console.log(`Candidates with TPA signal: ${candidates.length}`);
  console.log(`Queued top ${selected.length} (requested limit ${limit}), inserted ${inserted}`);
  const top10 = selected.slice(0, 10).map((s) => `${s.code ?? "-"} [${s.slug}] score=${s.score} :: ${s.reasons.map((r) => r.factor.split(":")[0]).join("; ")}`);
  console.log("\nTop 10 preview:");
  for (const t of top10) console.log(`  · ${t}`);

  const outDir = path.join(process.cwd(), "data", "reports", "research");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `queue-seed-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ requestedLimit: limit, candidates: candidates.length, inserted, selected }, null, 2));
  console.log(`\nReport: ${path.relative(process.cwd(), outFile)}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
