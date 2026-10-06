import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activities, jurisdictions, licenceTypes, approvals, approvalAuthorities } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { searchUnified } from "@/lib/search/engine";
import { getRegulatorySummaries } from "@/lib/search/enrichment";
import { requireViewer } from "@/lib/auth/viewer";
import { authErrorResponse } from "@/lib/auth/errors";
import type { ComparisonRow } from "@/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

interface SearchComparisonRow {
  jurisdiction: {
    id: string;
    name: string;
    slug: string;
    emirate: string;
    jurisdictionType: string;
  };
  status: "MATCH" | "NO_MATCH";
  matchType: string | null;
  matchScore: number | null;
  activity: {
    id: string;
    officialName: string;
    /**
     * The jurisdiction's own catalogue code, surfaced publicly as the "License
     * Number" for non-AFZ jurisdictions — see `src/lib/activities/identifier.ts`.
     */
    activityCode: string | null;
    /** Published ISIC classification. */
    isicCode: string | null;
    approvalStatus: string;
    approvalSignal: string;
    verificationStatus: string;
    lastVerified: string | null;
  } | null;
  licenceType: {
    name: string;
    code: string | null;
  } | null;
  licenceBinding: "verified" | "unknown";
  approvalStatus: {
    displayStatus: string;
    displayText: string;
    verifiedCount: number;
  };
  fees: {
    governmentFees: { amount: string | number | null; currency: string; feeType: string }[];
    thirdPartyCosts: { costType: string; estimatedAmount: string | number | null; currency: string }[];
    displayText: string;
  };
  source: {
    url: string;
    title: string;
    lastVerified: string | null;
  } | null;
  restrictions: string | null;
}

export async function GET(request: NextRequest) {
  // Comparison is built on the search engine, so it is gated identically.
  try {
    await requireViewer();
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const activityName = searchParams.get("activity");
  const q = searchParams.get("q");
  const jurisdictionIds = searchParams.getAll("jurisdictionId");
  const jurisdictionSlugs = searchParams.getAll("jurisdictionSlug");

  // ── MODE 1: Search-based comparison (new, enhanced) ──
  if (q) {
    return handleSearchComparison(q, jurisdictionSlugs);
  }

  // ── MODE 2: Legacy exact-name comparison (backward compatible) ──
  return handleLegacyComparison(activityName, jurisdictionIds);
}

async function handleSearchComparison(
  q: string,
  jurisdictionSlugs: string[]
): Promise<NextResponse> {
  const trimmed = q.trim();
  if (!trimmed) {
    return NextResponse.json(
      { error: "Query parameter 'q' is required" },
      { status: 400 }
    );
  }
  if (trimmed.length > 500) {
    return NextResponse.json(
      { error: "Query too long (max 500 characters)" },
      { status: 400 }
    );
  }

  const validSlugs = jurisdictionSlugs.filter(
    s => s && SLUG_RE.test(s) && s.length <= 200
  );
  if (validSlugs.length > 0 && validSlugs.length < 2) {
    return NextResponse.json(
      { error: "Provide at least 2 valid jurisdiction slugs" },
      { status: 400 }
    );
  }
  if (validSlugs.length > 4) {
    return NextResponse.json(
      { error: "Maximum 4 jurisdictions for comparison" },
      { status: 400 }
    );
  }

  try {
    // Comparison summarises the best match in EACH selected jurisdiction, so it is
    // grouped analysis rather than a page: paging is opted out of so a
    // jurisdiction whose matches rank past a page boundary still compares.
    const searchData = await searchUnified({
      q: trimmed,
      groupLimit: 5,
      allMatches: true,
    });

    const groups = validSlugs.length >= 2
      ? searchData.jurisdictionGroups.filter(g => validSlugs.includes(g.jurisdiction.slug))
      : searchData.jurisdictionGroups;

    // Enriched from the groups actually rendered below, so every compared
    // jurisdiction has a summary for the same activity it displays.
    const matchedIds = [
      ...new Set(
        groups
          .filter(g => g.status === "match")
          .flatMap(g => g.topResults.map(r => r.activity.id))
      ),
    ];
    const summaries = await getRegulatorySummaries(matchedIds);

    const rows: SearchComparisonRow[] = groups.map(group => {
      if (group.status === "no_match") {
        return {
          jurisdiction: group.jurisdiction,
          status: "NO_MATCH",
          matchType: null,
          matchScore: null,
          activity: null,
          licenceType: null,
          licenceBinding: "unknown" as const,
          approvalStatus: {
            displayStatus: "NOT_FOUND",
            displayText: "Not found in indexed activity data",
            verifiedCount: 0,
          },
          fees: {
            governmentFees: [],
            thirdPartyCosts: [],
            displayText: "Not found in indexed activity data",
          },
          source: null,
          restrictions: null,
        };
      }

      const best = group.topResults[0];
      if (!best) {
        return {
          jurisdiction: group.jurisdiction,
          status: "NO_MATCH",
          matchType: null,
          matchScore: null,
          activity: null,
          licenceType: null,
          licenceBinding: "unknown" as const,
          approvalStatus: {
            displayStatus: "NOT_FOUND",
            displayText: "Not found in indexed activity data",
            verifiedCount: 0,
          },
          fees: {
            governmentFees: [],
            thirdPartyCosts: [],
            displayText: "Not found in indexed activity data",
          },
          source: null,
          restrictions: null,
        };
      }

      const summary = summaries.get(best.activity.id) ?? null;
      const verifiedCount = summary?.verifiedApprovals.length ?? 0;

      let approvalDisplay = "UNKNOWN_REQUIRES_RESEARCH";
      let approvalText = "Unknown — requires research with the relevant authority";
      if (verifiedCount > 0) {
        approvalDisplay = "APPROVAL_VERIFIED";
        approvalText = "Approval verified in indexed official data";
      } else if (
        best.activity.approvalSignal === "third_party_approval_indicated" ||
        best.activity.approvalSignal === "may_be_required"
      ) {
        approvalDisplay = "APPROVAL_SIGNAL_PRESENT";
        approvalText = "Regulatory approval signal detected — verification pending";
      } else if (best.activity.approvalStatus === "no_additional_approval") {
        approvalDisplay = "NO_ADDITIONAL_APPROVAL_VERIFIED";
        approvalText = "No additional approval verified in indexed official data";
      }

      const govFees = (summary?.govFees ?? []).map(f => ({
        amount: f.amount,
        currency: f.currency,
        feeType: f.feeType,
      }));
      const tpc = (summary?.thirdPartyCosts ?? []).map(tpc => ({
        costType: tpc.costType,
        estimatedAmount: tpc.estimatedAmount,
        currency: tpc.currency,
      }));
      const hasFees = govFees.some(f => f.amount !== null) || tpc.some(t => t.estimatedAmount !== null);

      return {
        jurisdiction: group.jurisdiction,
        status: "MATCH",
        matchType: best.matchType,
        matchScore: best.matchScore,
        activity: {
          id: best.activity.id,
          officialName: best.activity.officialName,
          activityCode: best.activity.activityCode,
          isicCode: best.activity.isicCode,
          approvalStatus: best.activity.approvalStatus,
          approvalSignal: best.activity.approvalSignal,
          verificationStatus: best.activity.verificationStatus,
          lastVerified: best.activity.lastVerified,
        },
        licenceType: best.licenceType
          ? { name: best.licenceType.name, code: best.licenceType.code }
          : null,
        licenceBinding: best.licenceType ? "verified" : "unknown",
        approvalStatus: {
          displayStatus: approvalDisplay,
          displayText: approvalText,
          verifiedCount,
        },
        fees: {
          governmentFees: govFees,
          thirdPartyCosts: tpc,
          displayText: hasFees
            ? "Some fees verified in indexed official sources"
            : "Government fees not verified/published in indexed official sources",
        },
        source: best.source
          ? { url: best.source.url, title: best.source.title, lastVerified: best.source.lastVerified }
          : null,
        restrictions:
          (best.activity as unknown as Record<string, unknown>).restrictions as string ?? null,
      };
    });

    return NextResponse.json({
      query: searchData.query,
      results: rows,
      meta: {
        tookMs: searchData.meta.tookMs,
        totalMatched: rows.filter(r => r.status === "MATCH").length,
        totalUnmatched: rows.filter(r => r.status === "NO_MATCH").length,
      },
    });
  } catch (error) {
    console.error("Search comparison failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function handleLegacyComparison(
  activityName: string | null,
  jurisdictionIds: string[]
): Promise<NextResponse> {
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

  const invalidIds = jurisdictionIds.filter((id) => !UUID_RE.test(id));
  if (invalidIds.length > 0) {
    return NextResponse.json(
      { error: "Invalid jurisdiction ID format" },
      { status: 400 }
    );
  }

  if (activityName.length > 500) {
    return NextResponse.json(
      { error: "Activity name too long" },
      { status: 400 }
    );
  }

  try {
    const rows: ComparisonRow[] = [];

    for (const jid of jurisdictionIds) {
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
            eq(activities.normalizedName, activityName.toLowerCase())
          )
        )
        .limit(1);

      type ApprovalRow = {
        approval: typeof approvals.$inferSelect;
        authority: typeof approvalAuthorities.$inferSelect | null;
      };
      let approvalData: ApprovalRow[] = [];

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
      }

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
              isicCode: activityResults[0].activity.isicCode,
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
  } catch (error) {
    console.error("Comparison failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
