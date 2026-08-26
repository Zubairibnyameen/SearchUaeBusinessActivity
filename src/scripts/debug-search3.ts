import "dotenv/config";
import { db } from "@/lib/db";
import { activities, jurisdictions, licenceTypes, sources, activitySources } from "@/lib/db/schema";
import { ilike, eq, sql } from "drizzle-orm";

async function main() {
  const TIER_LIMIT = 15;
  
  const baseSelect = db.select({
    activity: activities,
    jurisdiction: jurisdictions,
    licenceType: licenceTypes,
    source: sources,
  })
    .from(activities)
    .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
    .leftJoin(licenceTypes, eq(activities.licenceTypeId, licenceTypes.id))
    .leftJoin(
      sources,
      sql` EXISTS (SELECT 1 FROM ${activitySources} WHERE ${activitySources.activityId} = ${activities.id} AND ${activitySources.sourceId} = ${sources.id}) `
    );

  // Test: primary noun "jewellery" search
  const results = await baseSelect
    .where(ilike(activities.normalizedName, `%jewellery%`))
    .limit(TIER_LIMIT);
  
  console.log(`Primary noun "jewellery" search: ${results.length} results`);
  for (const r of results.slice(0, 5)) {
    console.log(`  ${r.activity.officialName} (${r.activity.normalizedName})`);
  }

  // Test: primary noun "garment" search
  const results2 = await baseSelect
    .where(ilike(activities.normalizedName, `%garment%`))
    .limit(TIER_LIMIT);
  
  console.log(`\nPrimary noun "garment" search: ${results2.length} results`);
  for (const r of results2.slice(0, 5)) {
    console.log(`  ${r.activity.officialName} (${r.activity.normalizedName})`);
  }

  // Test: primary noun "consulting" search
  const results3 = await baseSelect
    .where(ilike(activities.normalizedName, `%consulting%`))
    .limit(TIER_LIMIT);
  
  console.log(`\nPrimary noun "consulting" search: ${results3.length} results`);
  for (const r of results3.slice(0, 5)) {
    console.log(`  ${r.activity.officialName} (${r.activity.normalizedName})`);
  }

  // Test: name contains "jewellery gold trading"
  const nq = "jewellery gold trading";
  const results4 = await baseSelect
    .where(ilike(activities.normalizedName, `%${nq}%`))
    .limit(TIER_LIMIT);
  
  console.log(`\nName contains "${nq}": ${results4.length} results`);
  for (const r of results4.slice(0, 5)) {
    console.log(`  ${r.activity.officialName} (${r.activity.normalizedName})`);
  }

  // Check: how many activities total?
  const count = await db.select({ count: sql<number>`count(*)::int` }).from(activities);
  console.log(`\nTotal activities: ${count[0].count}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
