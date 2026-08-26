import { NextRequest, NextResponse } from "next/server";
import { searchUnified, type SearchOptions } from "@/lib/search/engine";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const options: SearchOptions = {
    q: searchParams.get("q") || "",
    emirate: searchParams.get("emirate") || undefined,
    jurisdictionType: (searchParams.get("jurisdictionType") as "mainland" | "free_zone") || undefined,
    jurisdictionId: searchParams.get("jurisdictionId") || undefined,
    approvalStatus: searchParams.get("approvalStatus") || undefined,
    licenceType: searchParams.get("licenceType") || undefined,
    verifiedOnly: searchParams.get("verifiedOnly") === "true",
    limit: Math.min(Number(searchParams.get("limit")) || 20, 100),
    offset: Number(searchParams.get("offset")) || 0,
  };

  if (!options.q || options.q.trim().length === 0) {
    return NextResponse.json(
      { error: "Query parameter 'q' is required" },
      { status: 400 }
    );
  }

  try {
    const response = await searchUnified(options);
    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Search failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
