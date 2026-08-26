import "dotenv/config";
import { search } from "@/lib/search/engine";

async function main() {
  const queries = ["general trading", "consulting", "online electronics store"];
  for (const q of queries) {
    const results = await search({ q, limit: 25 });
    console.log(`\nQuery: "${q}" → ${results.length} results`);
    for (const r of results.slice(0, 5)) {
      console.log(`  ${r.activity.officialName} (${r.matchType}, ${r.matchScore})`);
      console.log(`    Reasons: ${r.matchReasons.join("; ")}`);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
