/**
 * Outbound projection for search responses.
 *
 * `searchUnified()` deliberately returns the internal `activityCode` because
 * the matcher needs it to score exact-code hits. That is a ranking concern only,
 * and it must never leave the server: the internal code is not published by any
 * authority and is not the ISIC classification.
 *
 * Rather than relying on every future caller to remember to delete a field, the
 * gated search endpoints pass their response through `toPublicSearchResponse()`.
 * The strip is explicit and total, so a code cannot reappear by accident.
 *
 * The published `isicCode` is preserved — that is the code users are meant to see.
 */
import type { SearchResultItem, UnifiedSearchResponse } from "./types";

export type PublicSearchResultItem = Omit<SearchResultItem, "activity"> & {
  activity: Omit<SearchResultItem["activity"], "activityCode">;
};

export type PublicUnifiedSearchResponse = Omit<UnifiedSearchResponse, "results" | "jurisdictionGroups"> & {
  results: PublicSearchResultItem[];
  jurisdictionGroups: {
    jurisdiction: UnifiedSearchResponse["jurisdictionGroups"][number]["jurisdiction"];
    status: UnifiedSearchResponse["jurisdictionGroups"][number]["status"];
    totalMatches: number;
    bestMatchType: UnifiedSearchResponse["jurisdictionGroups"][number]["bestMatchType"];
    topResults: PublicSearchResultItem[];
  }[];
};

function toPublicItem(item: SearchResultItem): PublicSearchResultItem {
  // Copy then delete, so a newly added activity column has to be opted into
  // rather than leaking by default.
  const activity = { ...item.activity } as Record<string, unknown>;
  delete activity.activityCode;
  return { ...item, activity } as PublicSearchResultItem;
}

export function toPublicSearchResponse(
  response: UnifiedSearchResponse
): PublicUnifiedSearchResponse {
  return {
    ...response,
    results: response.results.map(toPublicItem),
    jurisdictionGroups: response.jurisdictionGroups.map(group => ({
      ...group,
      topResults: group.topResults.map(toPublicItem),
    })),
  };
}
