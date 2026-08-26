import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approvalFees, approvals } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

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
    const activityApprovals = await db
      .select({ id: approvals.id })
      .from(approvals)
      .where(eq(approvals.activityId, id));

    if (activityApprovals.length === 0) {
      return NextResponse.json([]);
    }

    const approvalIds = activityApprovals.map((a) => a.id);

    const fees = await db
      .select()
      .from(approvalFees)
      .where(inArray(approvalFees.approvalId, approvalIds));

    return NextResponse.json(fees);
  } catch (error) {
    console.error("Failed to fetch fees:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
