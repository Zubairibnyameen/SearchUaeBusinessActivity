import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activities, jurisdictions, licenceTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const results = await db
    .select({
      activity: activities,
      jurisdiction: jurisdictions,
      licenceType: licenceTypes,
    })
    .from(activities)
    .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
    .leftJoin(licenceTypes, eq(activities.licenceTypeId, licenceTypes.id))
    .where(eq(activities.id, id))
    .limit(1);

  if (results.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(results[0]);
}
