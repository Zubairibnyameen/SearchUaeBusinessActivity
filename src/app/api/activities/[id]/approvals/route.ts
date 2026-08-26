import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approvals, approvalAuthorities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const results = await db
    .select({
      approval: approvals,
      authority: approvalAuthorities,
    })
    .from(approvals)
    .leftJoin(
      approvalAuthorities,
      eq(approvals.approvalAuthorityId, approvalAuthorities.id)
    )
    .where(eq(approvals.activityId, id));

  return NextResponse.json(results);
}
