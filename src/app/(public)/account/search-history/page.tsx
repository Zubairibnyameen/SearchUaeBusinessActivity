import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import {
  listSearchHistorySafely,
  SEARCH_HISTORY_PAGE_SIZE,
} from "@/lib/auth/search-usage";
import { SearchHistoryView } from "@/components/account/search-history";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your search history",
  description: "Review the searches you have run on UAE Activity Intelligence.",
  robots: { index: false, follow: false },
};

/**
 * Ceiling on `?page=`.
 *
 * A missing, negative, non-numeric or absurd `page` all collapse to 1 rather
 * than reaching the DAL, so a crafted value cannot ask for a deep offset scan.
 * It is not an authorization control — the row scope never comes from here —
 * just a bound on a number that becomes an OFFSET.
 */
const MAX_PAGE = 500;

/**
 * Whitelists the query string. `page` is the only parameter recognised, so any
 * other key — `userId`, `authUserId`, `id` — is simply not read. There is no
 * code path from the request to the row scope.
 */
function readPage(raw: { page?: string }): number {
  const parsed = Number.parseInt(raw.page ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_PAGE);
}

/**
 * The signed-in user's own search history.
 *
 * AUTHORIZATION
 *   `getViewer()` resolves identity from the verified Supabase session and
 *   nothing else, and the page takes no params beyond `page`. The page hands
 *   the whole `Viewer` to the DAL and the DAL filters on `viewer.id`, so the
 *   account whose rows are read is decided server-side from the session cookie.
 *   There is no query-string, route-segment or form value in this file that
 *   could point the query at another account, and no such value is accepted
 *   downstream either.
 *
 * WHY `getViewer()` AND NOT `requireViewer()`
 *   `requireViewer()` is the right gate for `/search` and the admin routes: it
 *   throws 403 for a suspended account because those pages perform a
 *   capability. This page performs none. `/account` and `/account/profile` both
 *   use `getViewer()` and redirect when there is no session, and a suspended
 *   person still sees their own details, totals and profile there. Using
 *   `requireViewer()` here would contradict that and would hide a suspended
 *   user's own history from them — suspension withdraws the ability to run new
 *   searches, it does not confiscate the record of the old ones. So the gate is
 *   "must have a session"; the only thing that changes for a suspended account
 *   is the on-page explanation, decided by the component.
 */
export default async function AccountSearchHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const viewer = await getViewer();

  // No verified session: this page shows personal data, so there is nothing to
  // render anonymously. Send them to sign in and bring them straight back.
  if (!viewer) {
    redirect(`/signin?next=${encodeURIComponent("/account/search-history")}`);
  }

  const page = readPage(await searchParams);
  const offset = (page - 1) * SEARCH_HISTORY_PAGE_SIZE;

  // `null` when the read failed, which the view reports as unavailable rather
  // than as an empty history.
  const history = await listSearchHistorySafely(viewer, {
    limit: SEARCH_HISTORY_PAGE_SIZE,
    offset,
  });

  return (
    <SearchHistoryView
      history={history}
      page={page}
      pageSize={SEARCH_HISTORY_PAGE_SIZE}
      isActive={viewer.isActive}
    />
  );
}
