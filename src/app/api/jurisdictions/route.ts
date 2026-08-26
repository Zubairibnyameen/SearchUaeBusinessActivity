import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jurisdictions } from "@/lib/db/schema";
import { eq, and, type SQL } from "drizzle-orm";

type EmirateFilter = (typeof jurisdictions.emirate)["enumValues"][number];
type JurisdictionTypeFilter = (typeof jurisdictions.jurisdictionType)["enumValues"][number];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const emirate = searchParams.get("emirate");
  const type = searchParams.get("type");

  const conditions: SQL[] = [];
  if (emirate) conditions.push(eq(jurisdictions.emirate, emirate as EmirateFilter));
  if (type) conditions.push(eq(jurisdictions.jurisdictionType, type as JurisdictionTypeFilter));

  const results = conditions.length > 0
    ? await db.select().from(jurisdictions).where(and(...conditions))
    : await db.select().from(jurisdictions);

  return NextResponse.json(results);
}
