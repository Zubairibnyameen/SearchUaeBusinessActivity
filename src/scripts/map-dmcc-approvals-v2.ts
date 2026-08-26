/**
 * Update DMCC activities with proper approval status.
 * Maps regulatory authority names from the official XLSX.
 */

import ExcelJS from "exceljs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import path from "path";
import { activities, jurisdictions } from "../lib/db/schema";
import { eq, and } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

async function main() {
  console.log("=== DMCC Regulated Activity Mapper (v2) ===\n");

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

  const [dmcc] = await db
    .select({ id: jurisdictions.id })
    .from(jurisdictions)
    .where(eq(jurisdictions.slug, "dmcc"))
    .limit(1);

  if (!dmcc) {
    console.error("DMCC not found");
    return;
  }

  // Build map: code -> { authority, restrictions }
  const regulatoryMap = new Map<string, { authority: string | null; restrictions: string }>();
  for (const row of dataRows) {
    const code = String(row["__EMPTY_5"] || "").trim();
    const authority = String(row["__EMPTY_14"] || "").trim() || null;
    const restrictions = String(row["__EMPTY_11"] || "").trim();
    if (code) {
      regulatoryMap.set(code, { authority, restrictions });
    }
  }

  let noApproval = 0;
  let pendingReview = 0;
  let withRestrictions = 0;

  for (const [code, info] of regulatoryMap) {
    const [activity] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(
        and(
          eq(activities.jurisdictionId, dmcc.id),
          eq(activities.activityCode, code)
        )
      )
      .limit(1);

    if (!activity) continue;

    if (info.authority) {
      // Activity requires third-party approval from a specific regulator
      await db
        .update(activities)
        .set({
          approvalStatus: "unknown",
          verificationStatus: "pending_review",
        })
        .where(eq(activities.id, activity.id));
      pendingReview++;
    } else {
      // No third-party approval required per official source
      await db
        .update(activities)
        .set({
          approvalStatus: "no_additional_approval",
        })
        .where(eq(activities.id, activity.id));
      noApproval++;
    }

    if (info.restrictions) {
      withRestrictions++;
    }
  }

  console.log(`No approval required: ${noApproval}`);
  console.log(`Pending regulatory research: ${pendingReview}`);
  console.log(`Activities with restrictions: ${withRestrictions}`);

  // Show unique authorities
  const authorities = new Map<string, number>();
  for (const [, info] of regulatoryMap) {
    if (info.authority) {
      // Some entries have multiple authorities separated by newlines
      const auths = info.authority.split(/\n\s*&\s*\n|\n/).map(a => a.trim());
      for (const auth of auths) {
        if (auth) authorities.set(auth, (authorities.get(auth) || 0) + 1);
      }
    }
  }

  console.log(`\nRegulatory authorities found (${authorities.size}):`);
  [...authorities.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([auth, count]) => console.log(`  ${count}x ${auth}`));

  await client.end();
  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
