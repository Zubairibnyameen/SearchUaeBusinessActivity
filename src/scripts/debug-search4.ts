import "dotenv/config";
import { db } from "@/lib/db";
import { activities } from "@/lib/db/schema";
import { ilike, eq } from "drizzle-orm";

async function main() {
  // Check "General Trading"
  const genTrading = await db.select({ name: activities.officialName, nn: activities.normalizedName })
    .from(activities)
    .where(ilike(activities.normalizedName, `%general trading%`))
    .limit(5);
  console.log("General Trading matches:", genTrading);

  // Check "consulting" expanded terms
  const consult = await db.select({ name: activities.officialName, nn: activities.normalizedName })
    .from(activities)
    .where(ilike(activities.normalizedName, `%consultan%`))
    .limit(10);
  console.log("\nConsultancy matches:", consult.map(c => c.name));

  // Check "electronic" matches
  const elec = await db.select({ name: activities.officialName, nn: activities.normalizedName })
    .from(activities)
    .where(ilike(activities.normalizedName, `%electronic%`))
    .limit(10);
  console.log("\nElectronic matches:", elec.map(e => e.name));

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
