import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getUserStats, listUsers, countUsers } from "@/lib/auth/viewer";
import { authErrorResponse } from "@/lib/auth/errors";

/**
 * Admin user list + statistics.
 *
 * Authorization is `requireAdmin()`, evaluated from the verified Supabase
 * session before any query parameter is read:
 *   - no session            -> 401
 *   - session, not admin    -> 403
 *
 * There is deliberately no `userId` / `email` / `role` / `isAdmin` parameter on
 * this route. Identity comes from the session cookie alone, so a caller cannot
 * widen its own scope by sending extra query parameters.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }

  const { searchParams } = new URL(request.url);

  const rawSearch = (searchParams.get("q") ?? "").trim().slice(0, 200);
  const rawRole = searchParams.get("role") ?? undefined;
  const rawStatus = searchParams.get("status") ?? undefined;

  // Whitelist: an unrecognised filter value is dropped, never interpolated.
  const role = rawRole === "user" || rawRole === "admin" ? rawRole : undefined;
  const status =
    rawStatus === "active" || rawStatus === "suspended" ? rawStatus : undefined;

  const rawLimit = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const rawOffset = Number.parseInt(searchParams.get("offset") ?? "", 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 25, 1), 200);
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);

  try {
    const [users, total, stats] = await Promise.all([
      listUsers({ search: rawSearch, role, status, limit, offset }),
      countUsers({ search: rawSearch, role, status }),
      getUserStats(),
    ]);

    return NextResponse.json(
      {
        users,
        pagination: { total, limit, offset, hasMore: offset + users.length < total },
        stats,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    console.error("[admin] failed to list users:", error);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}
