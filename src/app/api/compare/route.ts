import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activities, jurisdictions, licenceTypes, approvals, approvalAuthorities, approvalFees } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { ComparisonRow } from "@/types";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const activityName = searchParams.get("activity");
  const jurisdictionIds = searchParams.getAll("jurisdictionId");

  if (!activityName || jurisdictionIds.length < 2) {
    return NextResponse.json(
      { error: "Provide activity name and at least 2 jurisdiction IDs" },
      { status: 400 }
    );
  }

  if (jurisdictionIds.length > 5) {
    return NextResponse.json(
      { error: "Maximum 5 jurisdictions for comparison" },
      { status: 400 }
    );
  }

  // Search for the activity in each jurisdiction
  const rows: ComparisonRow[] = [];

  for (const jid of jurisdictionIds) {
    // Find activity in jurisdiction
    const activityResults = await db
      .select({
        activity: activities,
        jurisdiction: jurisdictions,
        licenceType: licenceTypes,
      })
      .from(activities)
      .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
      .leftJoin(licenceTypes, eq(activities.licenceTypeId, licenceTypes.id))
      .where(
        and(
          eq(activities.jurisdictionId, jid),
          sql`${activities.normalizedName} ILIKE ${"%" + activityName.toLowerCase() + "%"}`
        )
      )
      .limit(1);

    // Get approvals and fees
    type ApprovalRow = {
      approval: typeof approvals.$inferSelect;
      authority: typeof approvalAuthorities.$inferSelect | null;
    };
    let approvalData: ApprovalRow[] = [];
    let feeData: (typeof approvalFees.$inferSelect)[] = [];

    if (activityResults.length > 0) {
      const actId = activityResults[0].activity.id;

      approvalData = await db
        .select({
          approval: approvals,
          authority: approvalAuthorities,
        })
        .from(approvals)
        .leftJoin(
          approvalAuthorities,
          eq(approvals.approvalAuthorityId, approvalAuthorities.id)
        )
        .where(eq(approvals.activityId, actId));

      // Get fees for all approvals
      if (approvalData.length > 0) {
        const approvalIds = approvalData.map((a) => a.approval.id);
        feeData = await db
          .select()
          .from(approvalFees)
          .where(sql`${approvalFees.approvalId} IN ${sql.join(approvalIds.map(id => sql`${id}`), sql`, `)}`);
      }
    }

    // Build comparison row
    const jurisdiction = activityResults[0]?.jurisdiction || 
      (await db.select().from(jurisdictions).where(eq(jurisdictions.id, jid)).limit(1))[0];

    rows.push({
      jurisdiction: {
        id: jurisdiction.id,
        name: jurisdiction.name,
        slug: jurisdiction.slug,
        emirate: jurisdiction.emirate,
        jurisdictionType: jurisdiction.jurisdictionType,
      },
      activity: activityResults[0]
        ? {
            id: activityResults[0].activity.id,
            officialName: activityResults[0].activity.officialName,
            activityCode: activityResults[0].activity.activityCode,
            approvalStatus: activityResults[0].activity.approvalStatus,
            verificationStatus: activityResults[0].activity.verificationStatus,
          }
        : null,
      licenceType: activityResults[0]?.licenceType
        ? {
            name: activityResults[0].licenceType.name,
            code: activityResults[0].licenceType.code,
          }
        : null,
      approvals: approvalData.map((a) => ({
        id: a.approval.id,
        name: a.approval.name,
        approvalType: a.approval.approvalType,
        status: a.approval.status,
        authority: a.authority
          ? {
              name: a.authority.name,
              officialWebsite: a.authority.officialWebsite,
            }
          : null,
        description: a.approval.description,
        conditions: a.approval.conditions,
        requiredDocuments: a.approval.requiredDocuments,
        inspectionRequired: a.approval.inspectionRequired ?? false,
        nocRequired: a.approval.nocRequired ?? false,
        lastVerified: a.approval.lastVerified?.toString() ?? null,
      })),
      totalApprovalCost: null,
      totalRenewalCost: null,
      restrictions: [],
      dataConfidence: activityResults[0]?.activity.verificationStatus === "verified" ? "high" : "none",
    });
  }

  return NextResponse.json(rows);
}
