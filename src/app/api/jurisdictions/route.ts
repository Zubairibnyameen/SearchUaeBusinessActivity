import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jurisdictions } from "@/lib/db/schema";
import { eq, and, type SQL } from "drizzle-orm";

type EmirateFilter = (typeof jurisdictions.emirate)["enumValues"][number];
type JurisdictionTypeFilter = (typeof jurisdictions.jurisdictionType)["enumValues"][number];

const VALID_EMIRATES = new Set<string>(["abu_dhabi", "dubai", "sharjah", "ajman", "um_al_quwain", "ras_al_khaimah", "fujairah"]);
const VALID_TYPES = new Set<string>(["mainland", "free_zone"]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const emirate = searchParams.get("emirate");
  const type = searchParams.get("type");

  const conditions: SQL[] = [];
  if (emirate && VALID_EMIRATES.has(emirate)) conditions.push(eq(jurisdictions.emirate, emirate as EmirateFilter));
  if (type && VALID_TYPES.has(type)) conditions.push(eq(jurisdictions.jurisdictionType, type as JurisdictionTypeFilter));

  try {
    const results = conditions.length > 0
      ? await db.select().from(jurisdictions).where(and(...conditions))
      : await db.select().from(jurisdictions);

    return NextResponse.json(results);
  } catch (error) {
    console.error("Failed to fetch jurisdictions:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
