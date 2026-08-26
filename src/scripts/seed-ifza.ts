/**
 * Seeds the IFZA jurisdiction stub (priority jurisdiction #5).
 * Idempotent — safe to re-run.
 *
 * Usage: npx tsx src/scripts/seed-ifza.ts
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
    .where(eq(licensingAuthorities.slug, "ifza-authority"))
    .limit(1);

  if (!authority) {
    [authority] = await db
      .insert(licensingAuthorities)
      .values({
        name: "International Free Zone Authority",
        slug: "ifza-authority",
        emirate: "dubai",
        officialWebsite: "https://www.ifza.com/",
        description: "International Free Zone Authority (IFZA), Dubai",
      })
      .returning();
    console.log("Created licensing authority: ifza-authority");
  } else {
    console.log("Licensing authority exists: ifza-authority");
  }

  // 2. Jurisdiction
  let [jurisdiction] = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.slug, "ifza"))
    .limit(1);

  if (!jurisdiction) {
    [jurisdiction] = await db
      .insert(jurisdictions)
      .values({
        name: "IFZA",
        slug: "ifza",
        emirate: "dubai",
        jurisdictionType: "free_zone",
        authorityId: authority.id,
        officialWebsite: "https://www.ifza.com/",
        officialActivityUrl: "https://activities.ifza.com/",
        description: "International Free Zone Authority",
      })
      .returning();
    console.log("Created jurisdiction: ifza");
  } else {
    console.log("Jurisdiction exists: ifza");
  }

  // 3. Licence types — verbatim DED_License_Type labels published in the
  //    official register (Commercial / Professional).
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
        description: "DED commercial licence classification in IFZA register",
      },
      {
        jurisdictionId: jurisdiction.id,
        name: "Professional Licence",
        code: "PRO",
        description: "DED professional licence classification in IFZA register",
      },
    ]);
    console.log("Created 2 licence types for IFZA");
  } else {
    console.log(`IFZA already has ${existing.length} licence types`);
  }

  const check = await client`
    SELECT j.slug, j.name, COUNT(lt.id) AS licences
    FROM jurisdictions j LEFT JOIN licence_types lt ON lt.jurisdiction_id = j.id
    WHERE j.slug = 'ifza' GROUP BY j.slug, j.name`;
  console.log("Verify:", JSON.stringify(check));

  await client.end();
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
