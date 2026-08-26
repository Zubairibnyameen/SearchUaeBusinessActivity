import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activities, activitySynonyms } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  const results = await db
    .select({
      category: activities.officialCategory,
      count: sql<number>`count(*)`,
    })
    .from(activities)
    .where(sql`${activities.officialCategory} IS NOT NULL`)
    .groupBy(activities.officialCategory)
    .orderBy(sql`count(*) DESC`);

  return NextResponse.json(results);
}
