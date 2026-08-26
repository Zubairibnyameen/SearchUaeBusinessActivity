import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activities, jurisdictions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid activity ID" }, { status: 400 });
  }

  try {
    const results = await db
      .select({
        jurisdiction: jurisdictions,
      })
      .from(activities)
      .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
      .where(eq(activities.id, id));

    return NextResponse.json(results.map((r) => r.jurisdiction));
  } catch (error) {
    console.error("Failed to fetch jurisdictions:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
