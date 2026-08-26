import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activities, jurisdictions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const results = await db
    .select({
      jurisdiction: jurisdictions,
    })
    .from(activities)
    .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
    .where(eq(activities.id, id));

  return NextResponse.json(results.map((r) => r.jurisdiction));
}
