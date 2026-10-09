/**
 * Update DMCC activities with proper approval status based on regulated activity flags.
 * Creates a review queue for activities requiring regulatory research.
 */

import ExcelJS from "exceljs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import path from "path";
import { activities, jurisdictions, sources } from "../lib/db/schema";
import { eq, and } from "drizzle-orm";
import { assertDatabaseWritable } from "./db-safety";

assertDatabaseWritable("map-dmcc-approvals");
const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

async function main() {
  console.log("=== DMCC Regulated Activity Mapper ===\n");

  // Parse XLSX to get regulated flags
  const xlsxPath = path.join(process.cwd(), "data", "dmcc-activities.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("No worksheet found");

  const headers: string[] = [];
  const rawData: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber - 1] = String(cell.value ?? "");
      });
      return;
    }
    const obj: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      obj[headers[colNumber - 1] ?? `__EMPTY_${colNumber - 1}`] = cell.value;
    });
    rawData.push(obj);
  });
  const dataRows = rawData.slice(1);

  // Get DMCC jurisdiction
  const [dmcc] = await db
    .select({ id: jurisdictions.id })
    .from(jurisdictions)
    .where(eq(jurisdictions.slug, "dmcc"))
    .limit(1);

  if (!dmcc) {
    console.error("DMCC jurisdiction not found");
    return;
  }

  // Build map of activity code -> regulated flag
  const regulatedMap = new Map<string, { regulated: boolean; restrictions: string }>();
  for (const row of dataRows) {
    const code = String(row["__EMPTY_5"] || "").trim();
    const approvalRequired = String(row["__EMPTY_14"] || "").trim().toUpperCase();
    const restrictions = String(row["__EMPTY_11"] || "").trim();
    if (code) {
      regulatedMap.set(code, {
        regulated: approvalRequired === "Y",
        restrictions,
      });
    }
  }

  // Count regulated activities
  const regulatedCount = [...regulatedMap.values()].filter((v) => v.regulated).length;
  console.log(`Total DMCC activities: ${regulatedMap.size}`);
  console.log(`Regulated (third-party approval required): ${regulatedCount}\n`);

  // Update activities in database
  let updated = 0;
  let pendingReview = 0;

  for (const [code, info] of regulatedMap) {
    // Find activity by code in DMCC jurisdiction
    const [activity] = await db
      .select({ id: activities.id, approvalStatus: activities.approvalStatus })
      .from(activities)
      .where(
        and(
          eq(activities.jurisdictionId, dmcc.id),
          eq(activities.activityCode, code)
        )
      )
      .limit(1);

    if (!activity) continue;

    if (info.regulated) {
      // Mark as needing regulatory research - NOT "approval required" (that implies we know)
      await db
        .update(activities)
        .set({
          approvalStatus: "unknown",
          verificationStatus: "pending_review",
        })
        .where(eq(activities.id, activity.id));
      pendingReview++;
    }
    // Non-regulated activities keep their current status (no_additional_approval)
    updated++;
  }

  console.log(`Updated ${updated} activities`);
  console.log(`Marked ${pendingReview} as pending review (regulated/unknown approval)\n`);

  // Summary by approval status
  const allActivities = await db
    .select({ approvalStatus: activities.approvalStatus })
    .from(activities)
    .where(eq(activities.jurisdictionId, dmcc.id));

  const statusCounts = new Map<string, number>();
  for (const a of allActivities) {
    statusCounts.set(a.approvalStatus, (statusCounts.get(a.approvalStatus) || 0) + 1);
  }

  console.log("Approval status distribution:");
  statusCounts.forEach((count, status) =>
    console.log(`  ${status}: ${count}`)
  );

  await client.end();
  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
