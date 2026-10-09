/**
 * Seeds the Ajman Free Zone jurisdiction stub (priority jurisdiction #2).
 * Idempotent — safe to re-run.
 *
 * Usage: npx tsx src/scripts/seed-afz.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { loadEnvFile } from "../lib/db/env";
import {
  jurisdictions,
  licensingAuthorities,
  licenceTypes,
} from "../lib/db/schema";
import { assertDatabaseWritable } from "./db-safety";

async function main() {
  loadEnvFile();
  assertDatabaseWritable("seed-afz");
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);

  // 1. Licensing authority
  let [authority] = await db
    .select()
    .from(licensingAuthorities)
    .where(eq(licensingAuthorities.slug, "afz-authority"))
    .limit(1);

  if (!authority) {
    [authority] = await db
      .insert(licensingAuthorities)
      .values({
        name: "Ajman Free Zone",
        slug: "afz-authority",
        emirate: "ajman",
        officialWebsite: "https://www.afz.gov.ae/",
        description: "Ajman Free Zone authority",
      })
      .returning();
    console.log("Created licensing authority: afz-authority");
  } else {
    console.log("Licensing authority exists: afz-authority");
  }

  // 2. Jurisdiction
  let [jurisdiction] = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.slug, "afz"))
    .limit(1);

  if (!jurisdiction) {
    [jurisdiction] = await db
      .insert(jurisdictions)
      .values({
        name: "Ajman Free Zone",
        slug: "afz",
        emirate: "ajman",
        jurisdictionType: "free_zone",
        authorityId: authority.id,
        officialWebsite: "https://www.afz.gov.ae/",
        officialActivityUrl: "https://afz.gov.ae/activity-list/",
        description: "Ajman Free Zone",
      })
      .returning();
    console.log("Created jurisdiction: afz");
  } else {
    console.log("Jurisdiction exists: afz");
  }

  // 3. Licence types (source labels map: Commercial/General Trading/E-Commerce
  //    → COM, Services → PRO, Industrial → IND, Freelancer → FRE)
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
        description: "Commercial, general trading and e-commerce activities",
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
      {
        jurisdictionId: jurisdiction.id,
        name: "Freelancer Permit",
        code: "FRE",
        description: "Freelancer package permit",
      },
    ]);
    console.log("Created 4 licence types for AFZ");
  } else {
    console.log(`AFZ already has ${existing.length} licence types`);
  }

  // Verify
  const check = await client`
    SELECT j.slug, j.name, COUNT(lt.id) AS licences
    FROM jurisdictions j LEFT JOIN licence_types lt ON lt.jurisdiction_id = j.id
    WHERE j.slug = 'afz' GROUP BY j.slug, j.name`;
  console.log("Verify:", JSON.stringify(check));

  await client.end();
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
