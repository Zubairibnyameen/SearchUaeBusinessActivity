import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approvals, approvalAuthorities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public, unauthenticated approval list for one activity. `approvals` and
 * `approvalAuthorities` are spelled out as explicit projections rather than
 * whole-row `select({ approval: approvals, authority: approvalAuthorities })`,
 * so a future internal column added to either table cannot leak here by
 * default. The returned field set is unchanged.
 */
const PUBLIC_APPROVAL_COLUMNS = {
  id: approvals.id,
  activityId: approvals.activityId,
  approvalAuthorityId: approvals.approvalAuthorityId,
  name: approvals.name,
  approvalType: approvals.approvalType,
  status: approvals.status,
  description: approvals.description,
  conditions: approvals.conditions,
  requiredDocuments: approvals.requiredDocuments,
  professionalRequirement: approvals.professionalRequirement,
  facilityRequirement: approvals.facilityRequirement,
  inspectionRequired: approvals.inspectionRequired,
  nocRequired: approvals.nocRequired,
  applicationProcess: approvals.applicationProcess,
  sourceId: approvals.sourceId,
  lastVerified: approvals.lastVerified,
  verificationStatus: approvals.verificationStatus,
  createdAt: approvals.createdAt,
  updatedAt: approvals.updatedAt,
} as const;

const PUBLIC_AUTHORITY_COLUMNS = {
  id: approvalAuthorities.id,
  name: approvalAuthorities.name,
  slug: approvalAuthorities.slug,
  officialWebsite: approvalAuthorities.officialWebsite,
  description: approvalAuthorities.description,
  createdAt: approvalAuthorities.createdAt,
  updatedAt: approvalAuthorities.updatedAt,
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
        approval: PUBLIC_APPROVAL_COLUMNS,
        authority: PUBLIC_AUTHORITY_COLUMNS,
      })
      .from(approvals)
      .leftJoin(
        approvalAuthorities,
        eq(approvals.approvalAuthorityId, approvalAuthorities.id)
      )
      .where(eq(approvals.activityId, id));

    return NextResponse.json(results);
  } catch (error) {
    console.error("Failed to fetch approvals:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
