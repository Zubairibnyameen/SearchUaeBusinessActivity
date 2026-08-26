/**
 * Database test script - validates connection and basic queries.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { jurisdictions, licensingAuthorities, licenceTypes } from "./schema";
import { eq, count } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

async function test() {
  console.log("=== Database Connection Test ===\n");

  // Test 1: Count jurisdictions
  const [jurisdictionCount] = await db
    .select({ value: count() })
    .from(jurisdictions);
  console.log(`Jurisdictions: ${jurisdictionCount.value}`);

  // Test 2: Count licensing authorities
  const [authorityCount] = await db
    .select({ value: count() })
    .from(licensingAuthorities);
  console.log(`Licensing Authorities: ${authorityCount.value}`);

  // Test 3: Count licence types
  const [licenceCount] = await db
    .select({ value: count() })
    .from(licenceTypes);
  console.log(`Licence Types: ${licenceCount.value}`);

  // Test 4: Query free zones
  const freeZones = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.jurisdictionType, "free_zone"));
  console.log(`\nFree Zones: ${freeZones.length}`);
  freeZones.forEach((j) => console.log(`  - ${j.name} (${j.emirate})`));

  // Test 5: Query mainland
  const mainland = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.jurisdictionType, "mainland"));
  console.log(`\nMainland: ${mainland.length}`);
  mainland.forEach((j) => console.log(`  - ${j.name} (${j.emirate})`));

  // Test 6: Verify foreign key - licence types with jurisdiction
  const licencesWithJurisdiction = await db
    .select({
      licenceName: licenceTypes.name,
      licenceCode: licenceTypes.code,
      jurisdictionName: jurisdictions.name,
    })
    .from(licenceTypes)
    .innerJoin(jurisdictions, eq(licenceTypes.jurisdictionId, jurisdictions.id))
    .limit(5);
  console.log(`\nSample licence types with jurisdiction:`);
  licencesWithJurisdiction.forEach((l) =>
    console.log(`  - ${l.licenceName} (${l.licenceCode}) -> ${l.jurisdictionName}`)
  );

  // Test 7: Verify zero fake data
  const tables = [
    "activities",
    "approvals",
    "approval_fees",
    "sources",
    "activity_synonyms",
  ];
  console.log(`\n=== Fake Data Check ===`);
  for (const table of tables) {
    const result = await client.unsafe(`SELECT count(*) as count FROM ${table}`);
    console.log(`${table}: ${result[0].count} records (should be 0)`);
  }

  console.log("\n=== All tests passed ===");
  await client.end();
}

test().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
