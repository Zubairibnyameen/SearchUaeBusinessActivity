import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jurisdictions, licensingAuthorities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/**
 * Explicit public projections (this endpoint is unauthenticated). `db.select()`
 * and `select({ jurisdiction: jurisdictions })` return every column of the row;
 * the columns are spelled out here so a future internal field cannot leak by
 * default. The returned field set is unchanged.
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

const PUBLIC_AUTHORITY_COLUMNS = {
  id: licensingAuthorities.id,
  name: licensingAuthorities.name,
  slug: licensingAuthorities.slug,
  emirate: licensingAuthorities.emirate,
  officialWebsite: licensingAuthorities.officialWebsite,
  description: licensingAuthorities.description,
  createdAt: licensingAuthorities.createdAt,
  updatedAt: licensingAuthorities.updatedAt,
} as const;

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
        jurisdiction: PUBLIC_JURISDICTION_COLUMNS,
        authority: PUBLIC_AUTHORITY_COLUMNS,
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
