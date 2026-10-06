/**
 * Outbound projection for search responses.
 *
 * `searchUnified()` returns the jurisdiction's `activityCode` so the matcher can
 * score exact-code hits. The code is now ALSO a public identifier: non-AFZ
 * jurisdictions surface it as the "License Number" and AFZ surfaces the ISIC
 * code instead (see `src/lib/activities/identifier.ts`). The projection
 * therefore preserves both codes and associates them with their jurisdiction,
 * leaving the jurisdiction-aware display/copy logic to decide which one to show.
 *
 * The projection still serves a real gate: every field a caller receives here
 * is intentionally public and indexed-sourced.
 */
import type { SearchResultItem, UnifiedSearchResponse } from "./types";

export type PublicSearchResultItem = SearchResultItem;

export type PublicUnifiedSearchResponse = UnifiedSearchResponse;

export function toPublicSearchResponse(
  response: UnifiedSearchResponse
): PublicUnifiedSearchResponse {
  return response;
}