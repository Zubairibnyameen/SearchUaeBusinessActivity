/**
 * Database seed script.
 *
 * This script seeds the database with initial jurisdiction data.
 *
 * Run with: npm run db:seed
 *
 * IMPORTANT: This only creates jurisdiction stubs.
 * Activity data must be imported from official sources.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadEnvFile } from "./env";
import { assertDatabaseWritable } from "../../scripts/db-safety";
import {
  jurisdictions,
  licensingAuthorities,
  licenceTypes,
} from "./schema";

// Works both via `npm run db:seed` (which also gates through db-guard) and via
// direct execution (`npx tsx src/lib/db/seed.ts`). The gate runs before any
// connection is opened, so a remote/production host is refused by default.
loadEnvFile();
assertDatabaseWritable("db:seed");

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

async function seed() {
  console.log("Seeding database...");

  // Create licensing authorities
  const authorities = await db
    .insert(licensingAuthorities)
    .values([
      {
        name: "Department of Economy and Tourism (Dubai)",
        slug: "det-dubai",
        emirate: "dubai",
        officialWebsite: "https://www.dubaided.gov.ae",
        description: "Dubai mainland licensing authority",
      },
      {
        name: "Abu Dhabi Department of Economic Development",
        slug: "added-abu-dhabi",
        emirate: "abu_dhabi",
        officialWebsite: "https://www.added.gov.ae",
        description: "Abu Dhabi mainland licensing authority",
      },
      {
        name: "Sharjah Economic Development Department",
        slug: "sedd-sharjah",
        emirate: "sharjah",
        officialWebsite: "https://www.sedd.gov.ae",
        description: "Sharjah mainland licensing authority",
      },
      {
        name: "Ajman Department of Economic Development",
        slug: "ajman-ded",
        emirate: "ajman",
        officialWebsite: "https://www.ajman.ae",
        description: "Ajman mainland licensing authority",
      },
      {
        name: "RAK Economic Zone",
        slug: "rakez",
        emirate: "ras_al_khaimah",
        officialWebsite: "https://www.rakez.com",
        description: "RAK free zone authority",
      },
      {
        name: "Dubai Multi Commodities Centre",
        slug: "dmcc-authority",
        emirate: "dubai",
        officialWebsite: "https://www.dmcc.ae",
        description: "DMCC free zone authority",
      },
      {
        name: "International Free Zone Authority",
        slug: "ifza-authority",
        emirate: "dubai",
        officialWebsite: "https://www.ifza.ae",
        description: "IFZA free zone authority",
      },
      {
        name: "Sharjah Media City Free Zone",
        slug: "shams-authority",
        emirate: "sharjah",
        officialWebsite: "https://www.shams.ae",
        description: "SHAMS free zone authority",
      },
      {
        name: "Ajman Free Zone Authority",
        slug: "afza-authority",
        emirate: "ajman",
        officialWebsite: "https://www.afza.ae",
        description: "Ajman Free Zone authority",
      },
      {
        name: "Jebel Ali Free Zone Authority",
        slug: "jafza-authority",
        emirate: "dubai",
        officialWebsite: "https://www.jafza.ae",
        description: "JAFZA free zone authority",
      },
      {
        name: "Meydan Free Zone",
        slug: "meydan-authority",
        emirate: "dubai",
        officialWebsite: "https://www.meydanfz.ae",
        description: "Meydan free zone authority",
      },
      {
        name: "Fujairah Free Zone Authority",
        slug: "ffza-authority",
        emirate: "fujairah",
        officialWebsite: "https://www.ffza.gov.ae",
        description: "Fujairah free zone authority",
      },
      {
        name: "Abu Dhabi Global Market",
        slug: "adgm-authority",
        emirate: "abu_dhabi",
        officialWebsite: "https://www.adgm.com",
        description: "ADGM free zone authority",
      },
      {
        name: "Khalifa Economic Zones Abu Dhabi",
        slug: "kezad-authority",
        emirate: "abu_dhabi",
        officialWebsite: "https://www.kezadgroup.com",
        description: "KEZAD free zone authority",
      },
      {
        name: "Masdar City Free Zone",
        slug: "masdar-authority",
        emirate: "abu_dhabi",
        officialWebsite: "https://www.masdar.ae",
        description: "Masdar City free zone authority - clean energy and sustainability",
      },
      {
        name: "Abu Dhabi Airports Free Zone",
        slug: "adafz-authority",
        emirate: "abu_dhabi",
        officialWebsite: "https://www.abudhabiairports.ae",
        description: "Abu Dhabi Airports Free Zone",
      },
      {
        name: "twofour54",
        slug: "twofour54-authority",
        emirate: "abu_dhabi",
        officialWebsite: "https://www.twofour54.com",
        description: "twofour54 media free zone Abu Dhabi",
      },
    ])
    .returning({ id: licensingAuthorities.id, slug: licensingAuthorities.slug });

  console.log(`Created ${authorities.length} licensing authorities`);

  // Create jurisdictions
  const jurisdictionData = [
    // Free Zones
    {
      name: "Ajman Free Zone",
      slug: "ajman-free-zone",
      emirate: "ajman" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "afza-authority",
      officialWebsite: "https://www.afza.ae",
      description: "One of the oldest and most established free zones in the UAE",
    },
    {
      name: "DMCC",
      slug: "dmcc",
      emirate: "dubai" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "dmcc-authority",
      officialWebsite: "https://www.dmcc.ae",
      description: "Dubai Multi Commodities Centre - world's largest free zone",
    },
    {
      name: "IFZA",
      slug: "ifza",
      emirate: "dubai" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "ifza-authority",
      officialWebsite: "https://www.ifza.ae",
      description: "International Free Zone Authority in Dubai",
    },
    {
      name: "SHAMS",
      slug: "shams",
      emirate: "sharjah" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "shams-authority",
      officialWebsite: "https://www.shams.ae",
      description: "Sharjah Media City Free Zone",
    },
    {
      name: "RAKEZ",
      slug: "rakez",
      emirate: "ras_al_khaimah" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "rakez",
      officialWebsite: "https://www.rakez.com",
      description: "Ras Al Khaimah Economic Zone",
    },
    {
      name: "Meydan Free Zone",
      slug: "meydan-free-zone",
      emirate: "dubai" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "meydan-authority",
      officialWebsite: "https://www.meydanfz.ae",
      description: "Meydan free zone in Dubai",
    },
    {
      name: "JAFZA",
      slug: "jafza",
      emirate: "dubai" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "jafza-authority",
      officialWebsite: "https://www.jafza.ae",
      description: "Jebel Ali Free Zone - Dubai's flagship logistics free zone",
    },
    {
      name: "Fujairah Free Zone",
      slug: "fujairah-free-zone",
      emirate: "fujairah" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "ffza-authority",
      officialWebsite: "https://www.ffza.gov.ae",
      description: "Fujairah Free Zone Authority",
    },
    {
      name: "ADGM",
      slug: "adgm",
      emirate: "abu_dhabi" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "adgm-authority",
      officialWebsite: "https://www.adgm.com",
      description: "Abu Dhabi Global Market - international financial centre",
    },
    {
      name: "KEZAD",
      slug: "kezad",
      emirate: "abu_dhabi" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "kezad-authority",
      officialWebsite: "https://www.kezadgroup.com",
      description: "Khalifa Economic Zones Abu Dhabi",
    },
    {
      name: "Masdar City Free Zone",
      slug: "masdar-city",
      emirate: "abu_dhabi" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "masdar-authority",
      officialWebsite: "https://www.masdar.ae",
      description: "Masdar City - clean energy and sustainability focused free zone",
    },
    {
      name: "Abu Dhabi Airports Free Zone",
      slug: "abu-dhabi-airports-free-zone",
      emirate: "abu_dhabi" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "adafz-authority",
      officialWebsite: "https://www.abudhabiairports.ae",
      description: "Abu Dhabi Airports Free Zone",
    },
    {
      name: "twofour54",
      slug: "twofour54",
      emirate: "abu_dhabi" as const,
      jurisdictionType: "free_zone" as const,
      authoritySlug: "twofour54-authority",
      officialWebsite: "https://www.twofour54.com",
      description: "twofour54 - Abu Dhabi media free zone",
    },
    // Mainland
    {
      name: "Dubai Mainland",
      slug: "dubai-mainland",
      emirate: "dubai" as const,
      jurisdictionType: "mainland" as const,
      authoritySlug: "det-dubai",
      officialWebsite: "https://www.dubaided.gov.ae",
      description: "Dubai mainland - Department of Economy and Tourism",
    },
    {
      name: "Abu Dhabi Mainland",
      slug: "abu-dhabi-mainland",
      emirate: "abu_dhabi" as const,
      jurisdictionType: "mainland" as const,
      authoritySlug: "added-abu-dhabi",
      officialWebsite: "https://www.added.gov.ae",
      description: "Abu Dhabi mainland - ADDED",
    },
    {
      name: "Sharjah Mainland",
      slug: "sharjah-mainland",
      emirate: "sharjah" as const,
      jurisdictionType: "mainland" as const,
      authoritySlug: "sedd-sharjah",
      officialWebsite: "https://www.sedd.gov.ae",
      description: "Sharjah mainland - SEDD",
    },
    {
      name: "Ajman Mainland",
      slug: "ajman-mainland",
      emirate: "ajman" as const,
      jurisdictionType: "mainland" as const,
      authoritySlug: "ajman-ded",
      officialWebsite: "https://www.ajman.ae",
      description: "Ajman mainland - DED",
    },
    {
      name: "Ras Al Khaimah Mainland",
      slug: "ras-al-khaimah-mainland",
      emirate: "ras_al_khaimah" as const,
      jurisdictionType: "mainland" as const,
      authoritySlug: "rakez",
      officialWebsite: "https://www.rakez.com",
      description: "Ras Al Khaimah mainland",
    },
    {
      name: "Fujairah Mainland",
      slug: "fujairah-mainland",
      emirate: "fujairah" as const,
      jurisdictionType: "mainland" as const,
      authoritySlug: "ffza-authority",
      officialWebsite: "https://www.ffza.gov.ae",
      description: "Fujairah mainland",
    },
    {
      name: "Umm Al Quwain Mainland",
      slug: "umm-al-quwain-mainland",
      emirate: "umm_al_quwain" as const,
      jurisdictionType: "mainland" as const,
      authoritySlug: null,
      officialWebsite: null,
      description: "Umm Al Quwain mainland",
    },
  ];

  const authorityMap = new Map(authorities.map((a) => [a.slug, a.id]));

  const jurisdictionResults = await db
    .insert(jurisdictions)
    .values(
      jurisdictionData.map((j) => ({
        name: j.name,
        slug: j.slug,
        emirate: j.emirate,
        jurisdictionType: j.jurisdictionType,
        authorityId: j.authoritySlug ? authorityMap.get(j.authoritySlug) : null,
        officialWebsite: j.officialWebsite,
        description: j.description,
      }))
    )
    .returning({ id: jurisdictions.id, slug: jurisdictions.slug });

  console.log(`Created ${jurisdictionResults.length} jurisdictions`);

  // Create basic licence types for each jurisdiction
  const licenceData = jurisdictionResults.flatMap((j) => [
    {
      jurisdictionId: j.id,
      name: "Commercial Licence",
      code: "COM",
      description: "Commercial trading and services licence",
    },
    {
      jurisdictionId: j.id,
      name: "Professional Licence",
      code: "PRO",
      description: "Professional services licence",
    },
    {
      jurisdictionId: j.id,
      name: "Industrial Licence",
      code: "IND",
      description: "Industrial and manufacturing licence",
    },
  ]);

  const licenceResults = await db.insert(licenceTypes).values(licenceData).returning();
  console.log(`Created ${licenceResults.length} licence types`);

  console.log("Seeding complete!");
  console.log("\nNext steps:");
  console.log("1. Import activity data from official sources");
  console.log("2. Import approval and fee data");
  console.log("3. Run data quality audit");

  await client.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
