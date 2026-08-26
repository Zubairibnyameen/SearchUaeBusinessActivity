import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { activities } from "../lib/db/schema";
import { or, ilike } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client);

async function probe(label: string, terms: string[], limit = 15) {
  const rows = await db
    .select({ officialName: activities.officialName, nn: activities.normalizedName })
    .from(activities)
    .where(or(...terms.map((t) => ilike(activities.normalizedName, `%${t}%`))))
    .limit(limit);
  console.log(`\n=== ${label} (${terms.join(" | ")}) ===`);
  for (const r of rows) console.log("  ", r.officialName, "| nn=", r.nn);
}

async function main() {
  await probe("diamond", ["diamond"]);
  await probe("jewellery/jewel/gold/precious/gems", ["jewellery", "jewel", "gold", "precious", "gems"]);
  await probe("restaurant/cafe/bakery", ["restaurant", "cafe"]);
  await probe("gym/fitness", ["gym", "fitness"]);
  await probe("bank", ["bank"]);
  await probe("accounting/bookkeeping/audit", ["accounting", "bookkeeping", "audit"]);
  await probe("translation/interpret", ["translation", "translat", "interpret"]);
  await probe("wedding/event", ["wedding"]);
  await probe("security/guard", ["security", "guard"]);
  await probe("consult (all)", ["consult"]);
  await probe("technology/tech/it", ["technolog", "tech", "it services"], 20);
  await probe("advertising/marketing/pr", ["advertising", "marketing", "public relation"]);
  await probe("logistics/shipping/freight/cargo", ["logistics", "shipping", "freight", "cargo"], 20);
  await probe("education/training/academy", ["education", "training", "academy"], 20);
  await probe("engineering", ["engineering"]);
  await probe("crypto/blockchain/virtual assets", ["crypto", "crypto", "blockchain", "virtual asset"]);
  await probe("interior/decoration", ["interior", "decoration"]);
  await probe("software/programming/coding", ["software", "programming", "coding"], 20);
  await probe("real estate/property/broker", ["real estate", "broker"], 20);
  await probe("food/foodstuff/beverage", ["foodstuff", "beverage"], 20);
  await probe("travel/tourism", ["travel", "tourism"], 10);
  await probe("space/nuclear", ["space", "nuclear"], 10);
  await probe("petrol/fuel/gas station", ["fuel"]);
  await probe("clinic/medical/health/hospital", ["health care", "healthcare", "hospital"], 25);
  await probe("pharmacy/drug", ["pharmacy", "drug"]);
  await probe("station", ["station"], 20);
  await probe("online/ecommerce/marketplace", ["ecommerce", "e-commerce", "marketplace", "online"], 20);
  await probe("car/vehicle/motor", ["vehicle", "motor"]);
  await probe("insurance", ["insurance"]);
  await probe("recruitment/employment/staffing", ["recruit", "staffing", "manpower"]);
  await probe("legal/law", ["legal", "law"]);
  await probe("media/press", ["media", "press"]);
  await probe("sports/football/games", ["sports", "football", "basketball"], 15);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});