import { NextRequest, NextResponse } from "next/server";
import { getJurisdictionIntelligence } from "@/lib/search/jurisdiction-intelligence";

const MAX_QUERY_LENGTH = 500;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();

  if (!q) {
    return NextResponse.json(
      { error: "Query parameter 'q' is required" },
      { status: 400 }
    );
  }

  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters` },
      { status: 400 }
    );
  }

  try {
    const result = await getJurisdictionIntelligence(q);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Jurisdiction intelligence error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
