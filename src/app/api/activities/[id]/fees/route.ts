import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approvalFees, approvals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get all approvals for this activity
  const activityApprovals = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(eq(approvals.activityId, id));

  if (activityApprovals.length === 0) {
    return NextResponse.json([]);
  }

  const approvalIds = activityApprovals.map((a) => a.id);

  // Get fees for all approvals
  const fees = await db
    .select()
    .from(approvalFees)
    .where(
      approvalIds.length === 1
        ? eq(approvalFees.approvalId, approvalIds[0])
        : undefined
    );

  return NextResponse.json(fees);
}
