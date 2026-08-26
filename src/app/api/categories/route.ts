import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activities } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
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
  } catch (error) {
    console.error("Failed to fetch categories:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
