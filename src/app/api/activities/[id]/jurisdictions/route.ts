import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activities, jurisdictions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Explicit public projection (this endpoint is unauthenticated).
 * `select({ jurisdiction: jurisdictions })` returns every column; the list is
 * spelled out so a future internal field cannot leak by default. The returned
 * field set is unchanged.
 */
const PUBLIC_JURISDICTION_COLUMNS = {
  id: jurisdictions.id,
  name: jurisdictions.name,
  slug: jurisdictions.slug,
  emirate: jurisdictions.emirate,
  jurisdictionType: jurisdictions.jurisdictionType,
  authorityId: jurisdictions.authorityId,
  officialWebsite: jurisdictions.officialWebsite,
  officialActivityUrl: jurisdictions.officialActivityUrl,
  description: jurisdictions.description,
  status: jurisdictions.status,
  createdAt: jurisdictions.createdAt,
  updatedAt: jurisdictions.updatedAt,
} as const;

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
        jurisdiction: PUBLIC_JURISDICTION_COLUMNS,
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
