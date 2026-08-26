import "dotenv/config";
import { search } from "@/lib/search/engine";
import { db } from "@/lib/db";
import { activities, jurisdictions } from "@/lib/db/schema";
import { ilike, eq } from "drizzle-orm";

async function main() {
  const queries = [
    "online store selling clothes",
    "jewellery gold trading",
    "consulting",
    "technology",
    "wedding planning",
  ];
  
  for (const q of queries) {
    // First check what the intent is
    const results = await search({ q, limit: 5 });
    
    // Also do raw DB check
    const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    console.log(`\nQuery: "${q}"`);
    console.log(`  Words: [${words.join(", ")}]`);
    console.log(`  Results: ${results.length}`);
    
    // Check each word against DB
    for (const w of words) {
      const found = await db.select({ name: activities.officialName, nn: activities.normalizedName })
        .from(activities)
        .where(ilike(activities.normalizedName, `%${w}%`))
        .limit(3);
      if (found.length > 0) {
        console.log(`  Word "${w}" matches ${found.length}+ activities: ${found.map(f => f.name).join(", ")}`);
      }
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
