import { NextRequest, NextResponse } from "next/server";
import { searchUnified, type SearchOptions } from "@/lib/search/engine";

const MAX_QUERY_LENGTH = 2000;

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

  const options: SearchOptions = {
    q,
    emirate: searchParams.get("emirate") || undefined,
    jurisdictionType: (searchParams.get("jurisdictionType") as "mainland" | "free_zone") || undefined,
    jurisdictionId: searchParams.get("jurisdictionId") || undefined,
    approvalStatus: searchParams.get("approvalStatus") || undefined,
    licenceType: searchParams.get("licenceType") || undefined,
    verifiedOnly: searchParams.get("verifiedOnly") === "true",
    limit: Math.min(Number(searchParams.get("limit")) || 20, 100),
    offset: Number(searchParams.get("offset")) || 0,
  };

  try {
    const response = await searchUnified(options);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
