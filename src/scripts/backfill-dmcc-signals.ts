/**
 * BATCHED DMCC backfill of approval signals (Step 16).
 *
 * The generic importer's backfill mode is too slow for the remote Neon
 * pooler (one query per activity → thousands of round trips). This dedicated
 * path reuses the SAME tested decision logic (planBackfill / hasSameSignal)
 * but executes the whole backfill in a SINGLE transaction with a handful of
 * set-based queries:
 *
 *   1 tx: select jurisdiction          (1 query)
 *         select DMCC activities       (1 query)
 *         select existing DMCC signals (1 query)
 *         reuse DMCC source/contentHash(0-1 query)
 *         bulk INSERT ... VALUES(...)  (1 query)
 *         UPDATE ... WHERE id IN (...) (≤ a few, grouped by value-identity)
 *
 * Scope guard: jurisdiction=dmcc, official DMCC URL, activity count ≈1002,
 * evidence count ≈345, and DMCC rows must already exist. Any mismatch →
 * ABORT before any write.
 *
 * Usage: npx tsx src/scripts/backfill-dmcc-signals.ts
 * Requires DMCC_LOCAL_FILE to point at the verified official XLSX.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { loadEnvFile } from "../lib/db/env";
import { assertDatabaseWritable } from "./db-safety";
import {
  activities,
  jurisdictions,
  sources,
  activityApprovalSignals,
} from "../lib/db/schema";
import { dmccAdapter } from "../lib/ingestion/adapters/dmcc";
import { planBackfill, hasSameSignal } from "../lib/ingestion/backfill";
import { defaultValidate } from "../lib/ingestion/validate";
import { sha256 } from "../lib/ingestion/raw-store";
import type { NormalizedActivity } from "../lib/ingestion/types";

const JURISDICTION_SLUG = "dmcc";
const EXPECTED_ACTIVITIES = 1002;
const EXPECTED_EVIDENCE = 345;
const ACTIVITY_TOLERANCE = 8;
const EVIDENCE_TOLERANCE = 5;

function assertScope(cond: boolean, message: string) {
  if (!cond) throw new Error(`SCOPE GUARD FAILED: ${message}`);
}

function countEvidence(normalized: NormalizedActivity[]): number {
  return normalized.filter(
    (n) =>
      n.signalDetail?.signalType === "third_party_approval_required" &&
      Boolean(n.signalDetail.authorityName)
  ).length;
}

async function main() {
  loadEnvFile();
  assertDatabaseWritable("backfill-dmcc-signals");
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set");
  }

  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  try {
    // ---------------------------------------------------------------
    // Phase A — resolve jurisdiction + official source (no writes)
    // ---------------------------------------------------------------
    const [dmccJur] = await db
      .select({ id: jurisdictions.id })
      .from(jurisdictions)
      .where(eq(jurisdictions.slug, JURISDICTION_SLUG))
      .limit(1);
    assertScope(Boolean(dmccJur), `jurisdiction '${JURISDICTION_SLUG}' not found`);

    const discovered = await dmccAdapter.discover();
    const [src] = discovered;
    assertScope(Boolean(src) && src.id === "dmcc-activities", "expected dmcc-activities discovery");
    assertScope(
      Boolean(src) && src.url.includes("dmcc.ae") && src.format === "xlsx",
      `discovered source is not the official DMCC XLSX: ${src?.url}`
    );

    const payload = await dmccAdapter.fetch(src!);
    if (payload.httpStatus && payload.httpStatus >= 400) {
      throw new Error(`HTTP ${payload.httpStatus} from ${src!.url}`);
    }
    const fileHash = sha256(payload.body);
    console.log(`[dmcc] sha256 of source payload: ${fileHash}`);

    const parsed = await dmccAdapter.parse(payload);
    const normalized: NormalizedActivity[] = [];
    for (const row of parsed) {
      const n = dmccAdapter.normalize(row);
      const errors = defaultValidate(n).filter((x) => x.severity === "error");
      if (errors.length > 0) {
        console.warn(
          `[dmcc] skipping invalid row ${n.activityCode ?? "(no code)"}: ${errors
            .map((e) => e.message)
            .join("; ")}`
        );
        continue;
      }
      normalized.push(n);
    }

    // Deduplicate by activity code within the batch (matches importer semantics)
    const byCode = new Map<string, NormalizedActivity>();
    let batchDupes = 0;
    for (const n of normalized) {
      if (!n.activityCode) continue;
      if (byCode.has(n.activityCode)) {
        batchDupes += 1;
        continue;
      }
      byCode.set(n.activityCode, n);
    }
    const uniqueRows = [...byCode.values()];
    const evidenceCount = countEvidence(uniqueRows);

    console.log(
      `[dmcc] parsed=${parsed.length} unique=${uniqueRows.length} batchDuplicates=${batchDupes} evidence=${evidenceCount}`
    );

    // Scope guard (approximations allowed within stated tolerance)
    assertScope(
      uniqueRows.length >= EXPECTED_ACTIVITIES - ACTIVITY_TOLERANCE &&
        uniqueRows.length <= EXPECTED_ACTIVITIES + ACTIVITY_TOLERANCE,
      `unique activity codes ${uniqueRows.length} outside expected range ${EXPECTED_ACTIVITIES}±${ACTIVITY_TOLERANCE}`
    );
    assertScope(
      evidenceCount >= EXPECTED_EVIDENCE - EVIDENCE_TOLERANCE &&
        evidenceCount <= EXPECTED_EVIDENCE + EVIDENCE_TOLERANCE,
      `evidence-backed authority count ${evidenceCount} outside expected range ${EXPECTED_EVIDENCE}±${EVIDENCE_TOLERANCE}`
    );
    console.log("[dmcc] scope guard OK (no writes yet)");

    // ---------------------------------------------------------------
    // Phase B — ONE transaction, set-based writes
    // ---------------------------------------------------------------
    const counters = {
      existingActivities: 0,
      unmatched: 0,
      signalsInserted: 0,
      activitiesUpdated: 0,
      noop: 0,
      backfilled: 0,
      sourceHashSet: 0,
      updateGroups: 0,
    };

    await db.transaction(async (tx) => {
      const today = new Date().toISOString().split("T")[0];

      // B1. Existing DMCC activities (dmcc rows only, NOT the whole table)
      const existingActivities = await tx
        .select({
          id: activities.id,
          activityCode: activities.activityCode,
          approvalSignal: activities.approvalSignal,
          approvalStatus: activities.approvalStatus,
          verificationStatus: activities.verificationStatus,
        })
        .from(activities)
        .where(eq(activities.jurisdictionId, dmccJur!.id));
      counters.existingActivities = existingActivities.length;

      assertScope(
        existingActivities.length >= EXPECTED_ACTIVITIES - ACTIVITY_TOLERANCE &&
          existingActivities.length <= EXPECTED_ACTIVITIES + ACTIVITY_TOLERANCE,
        `existing DMCC activity count ${existingActivities.length} outside expected range`
      );

      // B2. Existing DMCC signals (single query, filtered to DMCC activity ids)
      const dmccIds = existingActivities.map((a) => a.id);
      const existingSignals = dmccIds.length
        ? await tx
            .select({
              activityId: activityApprovalSignals.activityId,
              signalType: activityApprovalSignals.signalType,
              authorityName: activityApprovalSignals.authorityName,
            })
            .from(activityApprovalSignals)
            .where(inArray(activityApprovalSignals.activityId, dmccIds))
        : [];
      const signalsByActivity = new Map<string, typeof existingSignals>();
      for (const s of existingSignals) {
        const list = signalsByActivity.get(s.activityId) ?? [];
        list.push(s);
        signalsByActivity.set(s.activityId, list);
      }
      if (existingSignals.length > 0) {
        console.warn(
          `[dmcc] found ${existingSignals.length} pre-existing signals (idempotent re-run expected to add none)`
        );
      }

      // B3. Reuse the existing DMCC source record + backfill content hash
      const [source] = await tx
        .select({ id: sources.id, contentHash: sources.contentHash })
        .from(sources)
        .where(eq(sources.url, src!.url))
        .limit(1);
      assertScope(
        Boolean(source),
        `no existing source record for official DMCC XLSX (${src!.url})`
      );
      const sourceId = source!.id;
      if (!source!.contentHash || source!.contentHash !== fileHash) {
        await tx
          .update(sources)
          .set({
            contentHash: fileHash,
            lastVerified: today,
            updatedAt: new Date(),
          })
          .where(eq(sources.id, sourceId));
        counters.sourceHashSet += 1;
      }

      // B4. Decisions with the SAME tested logic; group set-based writes
      const activityByCode = new Map(
        existingActivities.map((a) => [a.activityCode, a] as const)
      );

      type SignalInsert = {
        activityId: string;
        signalType: NonNullable<
          (typeof activityApprovalSignals.$inferInsert)["signalType"]
        >;
        authorityName: string | null;
        notes: string | null;
        sourceId: string;
        lastVerified: string;
      };
      const signalInsertValues: SignalInsert[] = [];

      const updateGroups = new Map<
        string,
        { set: Record<string, unknown>; ids: string[] }
      >();

      let unmatched = 0;
      for (const n of uniqueRows) {
        const act = activityByCode.get(n.activityCode!);
        if (!act) {
          unmatched += 1;
          continue;
        }

        const plan = planBackfill(
          {
            approvalSignal: act.approvalSignal,
            approvalStatus: act.approvalStatus,
            verificationStatus: act.verificationStatus,
          },
          n.signalDetail
        );

        if (plan.kind === "insert_signal" && plan.signalDetail) {
          const existing = signalsByActivity.get(act.id);
          if (!existing || !hasSameSignal(existing, plan.signalDetail)) {
            signalInsertValues.push({
              activityId: act.id,
              signalType:
                plan.signalDetail.signalType ?? "third_party_approval_required",
              authorityName: plan.signalDetail.authorityName ?? null,
              notes: plan.signalDetail.notes ?? null,
              sourceId,
              lastVerified: today,
            });
          }

          const update: Record<string, unknown> = { lastVerified: today };
          if (plan.needsSignalUpdate) {
            update.approvalSignal = "third_party_approval_indicated";
          }
          if (plan.patch?.approvalStatus !== undefined) {
            update.approvalStatus = plan.patch.approvalStatus;
          }
          if (plan.patch?.verificationStatus !== undefined) {
            update.verificationStatus = plan.patch.verificationStatus;
          }
          const hasUpdate =
            update.approvalSignal !== undefined ||
            update.approvalStatus !== undefined ||
            update.verificationStatus !== undefined;
          if (hasUpdate) {
            const key = JSON.stringify(update);
            const group = updateGroups.get(key) ?? { set: update, ids: [] };
            group.ids.push(act.id);
            updateGroups.set(key, group);
          } else {
            counters.noop += 1;
          }
        } else if (plan.kind === "update_status" && plan.patch) {
          const update: Record<string, unknown> = { lastVerified: today };
          if (plan.patch.approvalStatus !== undefined) {
            update.approvalStatus = plan.patch.approvalStatus;
          }
          if (plan.patch.verificationStatus !== undefined) {
            update.verificationStatus = plan.patch.verificationStatus;
          }
          const key = JSON.stringify(update);
          const group = updateGroups.get(key) ?? { set: update, ids: [] };
          group.ids.push(act.id);
          updateGroups.set(key, group);
        } else {
          counters.noop += 1;
        }
      }
      counters.unmatched = unmatched;

      // B5. Execute writes
      if (signalInsertValues.length > 0) {
        await tx.insert(activityApprovalSignals).values(signalInsertValues);
      }
      for (const group of updateGroups.values()) {
        await tx
          .update(activities)
          .set(group.set)
          .where(inArray(activities.id, group.ids));
        counters.activitiesUpdated += group.ids.length;
        counters.updateGroups += 1;
      }

      counters.signalsInserted = signalInsertValues.length;
      counters.backfilled =
        counters.signalsInserted + counters.activitiesUpdated;
    });

    // ---------------------------------------------------------------
    // Phase C — report
    // ---------------------------------------------------------------
    console.log("\n=== DMCC Backfill Report ===");
    console.log(`Existing DMCC activities:  ${counters.existingActivities}`);
    console.log(`Unmatched (code not in DB): ${counters.unmatched}`);
    console.log(`Signals inserted:          ${counters.signalsInserted}`);
    console.log(`Activities updated:        ${counters.activitiesUpdated}`);
    console.log(`No-op:                     ${counters.noop}`);
    console.log(`Backfilled (insert+update):${counters.backfilled}`);
    console.log(`Source contentHash set:    ${counters.sourceHashSet}`);
    console.log(`UPDATE statement groups:   ${counters.updateGroups}`);
    console.log(`Approx DB round trips:     5 + ${counters.signalsInserted ? 1 : 0} + ${counters.updateGroups} + ${counters.sourceHashSet ? 1 : 0}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("DMCC backfill failed:", e);
  process.exit(1);
});