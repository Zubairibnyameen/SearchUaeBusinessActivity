import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jurisdictions, licensingAuthorities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const results = await db
    .select({
      jurisdiction: jurisdictions,
      authority: licensingAuthorities,
    })
    .from(jurisdictions)
    .leftJoin(
      licensingAuthorities,
      eq(jurisdictions.authorityId, licensingAuthorities.id)
    )
    .where(eq(jurisdictions.slug, slug))
    .limit(1);

  if (results.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(results[0]);
}
