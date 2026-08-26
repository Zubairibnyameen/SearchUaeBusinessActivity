import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jurisdictions, licensingAuthorities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  if (!slug || slug.length > 200 || !SLUG_RE.test(slug)) {
    return NextResponse.json({ error: "Invalid jurisdiction slug" }, { status: 400 });
  }

  try {
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
  } catch (error) {
    console.error("Failed to fetch jurisdiction:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
