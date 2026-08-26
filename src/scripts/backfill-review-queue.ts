/**
 * Backfills import_review_queue for a jurisdiction whose import ran BEFORE
 * queue retention existed. Replays the adapter pipeline offline
 * (parse → normalize → detectBatchDuplicates) against the preserved raw
 * artifact and inserts every skipped batch-duplicate row.
 * Idempotent — rows already queued (same jurisdiction + code + reason) are skipped.
 *
 * Usage: npx tsx src/scripts/backfill-review-queue.ts <slug>
 */

import fs from "fs";
import path from "path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import {
  jurisdictions,
  importReviewQueue,
} from "../lib/db/schema";
import { detectBatchDuplicates } from "../lib/ingestion/validate";
import type { OfficialActivitySourceAdapter, NormalizedActivity } from "../lib/ingestion/types";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

interface AdapterModule {
  adapter: OfficialActivitySourceAdapter;
}

const ADAPTERS: Record<string, () => Promise<AdapterModule>> = {
  rakez: () =>
    import("../lib/ingestion/adapters/rakez").then((m) => ({
      adapter: m.rakezAdapter,
    })),
};

async function main() {
  const slug = process.argv[2];
  const loader = ADAPTERS[slug];
  if (!loader) {
    console.error(`No offline replay wired for '${slug}'.`);
    process.exit(1);
  }

  loadEnv();
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);

  const [jur] = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.slug, slug))
    .limit(1);
  if (!jur) throw new Error(`Jurisdiction '${slug}' not found`);

  const { adapter } = await loader();

  // Offline replay from the preserved raw artifact(s)
  const sources = await adapter.discover();
  const parsed = [];
  for (const source of sources) {
    const payload = await adapter.fetch(source);
    parsed.push(...(await adapter.parse(payload)));
  }
  const normalized: NormalizedActivity[] = parsed.map((a) => adapter.normalize(a));

  const dupes = detectBatchDuplicates(normalized);
  console.log(
    `Replay: ${normalized.length} rows, ${dupes.duplicateCodeIndexes.length} batch-duplicate index(es)`
  );

  let inserted = 0;
  for (const i of [...dupes.duplicateCodeIndexes].sort((a, b) => a - b)) {
    const n: NormalizedActivity = normalized[i];
    const existing = await db
      .select({ id: importReviewQueue.id })
      .from(importReviewQueue)
      .where(
        and(
          eq(importReviewQueue.jurisdictionId, jur.id),
          eq(importReviewQueue.reason, "batch_duplicate_code"),
          n.activityCode
            ? eq(importReviewQueue.activityCode, n.activityCode!)
            : eq(importReviewQueue.normalizedName, n.normalizedName),
          n.zone
            ? eq(importReviewQueue.zone, n.zone)
            : eq(importReviewQueue.zone, "")
        )
      )
      .limit(1);
    if (existing.length > 0) {
      console.log(`Already queued: ${n.activityCode} [${n.zone ?? "-"}]`);
      continue;
    }
    await db.insert(importReviewQueue).values({
      jurisdictionId: jur.id,
      discoveryId: sources[0]?.id,
      reason: "batch_duplicate_code",
      activityCode: n.activityCode ?? null,
      zone: n.zone ?? null,
      normalizedName: n.normalizedName ?? null,
      raw: n.raw,
    });
    inserted += 1;
    console.log(
      `Queued: ${n.activityCode} — "${n.officialName}" [${n.zone ?? "-"}]`
    );
  }
  console.log(`Inserted ${inserted} row(s)`);

  await client.end();
}

main().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
