import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activities, jurisdictions, licenceTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public, unauthenticated activity detail — the JSON counterpart of the public
 * `/activities/[id]` page, so a shared link works with no account.
 *
 * The projection is EXPLICIT rather than `select({ activity: activities })`,
 * which is what this used to do. The whole-row form returned `sourceExtra` (the
 * authority's raw row, e.g. import bookkeeping) and `activityCode` to anyone who
 * asked. `sourceExtra` is internal and is never exposed. `activityCode` is a
 * public identifier for non-AFZ jurisdictions (shown as the "License Number" on
 * the page — see `src/lib/activities/identifier.ts`); it is intentionally left
 * out of this JSON endpoint, so this response is narrower than the rendered
 * page. Only the published ISIC classification is carried here.
 */
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
        activity: {
          id: activities.id,
          officialName: activities.officialName,
          officialNameAr: activities.officialNameAr,
          normalizedName: activities.normalizedName,
          isicCode: activities.isicCode,
          description: activities.description,
          officialCategory: activities.officialCategory,
          normalizedCategory: activities.normalizedCategory,
          activityGroup: activities.activityGroup,
          activitySubcategory: activities.activitySubcategory,
          zone: activities.zone,
          restrictions: activities.restrictions,
          approvalSignal: activities.approvalSignal,
          approvalStatus: activities.approvalStatus,
          verificationStatus: activities.verificationStatus,
          lastVerified: activities.lastVerified,
          createdAt: activities.createdAt,
          updatedAt: activities.updatedAt,
        },
        jurisdiction: {
          id: jurisdictions.id,
          name: jurisdictions.name,
          slug: jurisdictions.slug,
          emirate: jurisdictions.emirate,
          jurisdictionType: jurisdictions.jurisdictionType,
        },
        licenceType: {
          id: licenceTypes.id,
          name: licenceTypes.name,
          code: licenceTypes.code,
        },
      })
      .from(activities)
      .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
      .leftJoin(licenceTypes, eq(activities.licenceTypeId, licenceTypes.id))
      .where(eq(activities.id, id))
      .limit(1);

    if (results.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(results[0], {
      headers: { "cache-control": "public, max-age=300" },
    });
  } catch (error) {
    console.error("Failed to fetch activity:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
