import { NextRequest, NextResponse } from "next/server";
import { searchUnified, type SearchOptions } from "@/lib/search/engine";
import { toPublicSearchResponse } from "@/lib/search/public-projection";
import { requireViewer } from "@/lib/auth/viewer";
import { authErrorResponse } from "@/lib/auth/errors";
import { recordSearchUsageSafely } from "@/lib/auth/search-usage";
import { checkRateLimitDecision } from "@/lib/auth/rate-limit";

const MAX_QUERY_LENGTH = 2000;

/**
 * Build the 429 body.
 *
 * Generic on purpose: the caller is told the request was rate limited and when
 * to retry, and nothing else. No limit value, no key, no IP, no user-agent and
 * no hint about which identity was counted.
 */
function rateLimitedResponse(retryAfterSeconds: number | null): NextResponse {
  const headers: Record<string, string> = { "cache-control": "private, no-store" };
  // Only sent when the limiter knows the window; a null would be a lie.
  if (retryAfterSeconds !== null) {
    headers["retry-after"] = String(retryAfterSeconds);
  }
  return NextResponse.json(
    { error: "Too many requests. Please slow down.", code: "RATE_LIMITED" },
    { status: 429, headers }
  );
}

export async function GET(request: NextRequest) {
  // Search is a gated product feature. The check runs BEFORE any parsing or
  // database work so an unauthenticated caller cannot use this endpoint to
  // probe indexed data, enumerate parameters, or measure the engine.
  //
  // The resolved viewer is kept: it is the only accepted source of the account
  // id used to record usage, so usage can never be attributed to a userId taken
  // from the query string.
  let viewer;
  try {
    viewer = await requireViewer();
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }

  // Rate limiting runs AFTER authentication and BEFORE any engine or database
  // work. That ordering is deliberate:
  //
  //   - after auth, so the limiter can key on the verified account and an
  //     anonymous or suspended caller is still answered by the existing 401/403
  //     rules rather than by a quota;
  //   - before the query is even read, so a rejected request costs one Map
  //     lookup instead of a full ranking pass — the expensive thing is exactly
  //     what we refuse to spend.
  //
  // The key is derived from `viewer.id`, the account id from the verified
  // session. No query parameter participates in it, so `?userId=`, `?q=`, or any
  // other crafted input cannot mint a fresh allowance by varying the request.
  // Nothing about the caller (IP, user-agent, query text) is stored or logged.
  const limit = checkRateLimitDecision(
    `search:user:${viewer.id}`,
    "search"
  );
  if (!limit.allowed) {
    // Deliberately before `recordSearchUsageSafely`: a request that was refused
    // is not a search that happened, so it must not inflate the account's own
    // usage history either.
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

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

    // Usage is recorded only after the engine has actually answered, so a
    // failed or rejected request is never counted as a search. This is
    // best-effort bookkeeping: `recordSearchUsageSafely` cannot throw, cannot
    // see anything but `viewer`, and adds nothing to the response body, so the
    // ranking, the payload and the public projection are all unchanged whether
    // the insert succeeds or fails.
    await recordSearchUsageSafely(viewer, q);

    // Public projection. `toPublicSearchResponse` is a pass-through by design:
    // every field the engine returns is already indexed-source public data, and
    // `activityCode`/`isicCode` are both public identifiers (non-AFZ shows the
    // code as "License Number", AFZ shows the ISIC code — see
    // `src/lib/activities/identifier.ts`). The projection remains the single
    // place to redact if a future field stops being public.
    return NextResponse.json(toPublicSearchResponse(response), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
