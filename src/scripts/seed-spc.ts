/**
 * Seeds the SPC Free Zone jurisdiction stub (priority jurisdiction #5).
 * Idempotent — safe to re-run.
 *
 * Usage: npx tsx src/scripts/seed-spc.ts
 */

import fs from "fs";
import path from "path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import {
  jurisdictions,
  licensingAuthorities,
  licenceTypes,
} from "../lib/db/schema";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function main() {
  loadEnv();
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);

  // 1. Licensing authority
  let [authority] = await db
    .select()
    .from(licensingAuthorities)
    .where(eq(licensingAuthorities.slug, "spc-authority"))
    .limit(1);

  if (!authority) {
    [authority] = await db
      .insert(licensingAuthorities)
      .values({
        name: "Sharjah Publishing City Free Zone",
        slug: "spc-authority",
        emirate: "sharjah",
        officialWebsite: "https://www.spcfz.ae/",
        description: "Sharjah Publishing City Free Zone authority",
      })
      .returning();
    console.log("Created licensing authority: spc-authority");
  } else {
    console.log("Licensing authority exists: spc-authority");
  }

  // 2. Jurisdiction
  let [jurisdiction] = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.slug, "spc"))
    .limit(1);

  if (!jurisdiction) {
    [jurisdiction] = await db
      .insert(jurisdictions)
      .values({
        name: "SPC Free Zone",
        slug: "spc",
        emirate: "sharjah",
        jurisdictionType: "free_zone",
        authorityId: authority.id,
        officialWebsite: "https://www.spcfz.ae/",
        officialActivityUrl: "https://www.spcfz.ae/business-activities/",
        description: "Sharjah Publishing City Free Zone",
      })
      .returning();
    console.log("Created jurisdiction: spc");
  } else {
    console.log("Jurisdiction exists: spc");
  }

  // 3. Licence types (match existing seeded pattern)
  const existing = await db
    .select()
    .from(licenceTypes)
    .where(eq(licenceTypes.jurisdictionId, jurisdiction.id));

  if (existing.length === 0) {
    await db.insert(licenceTypes).values([
      {
        jurisdictionId: jurisdiction.id,
        name: "Commercial Licence",
        code: "COM",
        description: "Commercial trading and services licence",
      },
      {
        jurisdictionId: jurisdiction.id,
        name: "Professional Licence",
        code: "PRO",
        description: "Professional services licence",
      },
      {
        jurisdictionId: jurisdiction.id,
        name: "Industrial Licence",
        code: "IND",
        description: "Industrial and manufacturing licence",
      },
    ]);
    console.log("Created 3 licence types for SPC");
  } else {
    console.log(`SPC already has ${existing.length} licence types`);
  }

  // Verify
  const check = await client`
    SELECT j.slug, j.name, COUNT(lt.id) AS licences
    FROM jurisdictions j LEFT JOIN licence_types lt ON lt.jurisdiction_id = j.id
    WHERE j.slug = 'spc' GROUP BY j.slug, j.name`;
  console.log("Verify:", JSON.stringify(check));

  await client.end();
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
