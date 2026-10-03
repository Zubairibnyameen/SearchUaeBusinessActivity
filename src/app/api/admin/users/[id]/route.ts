import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/viewer";
import { authErrorResponse, ForbiddenError } from "@/lib/auth/errors";
import { getAdminUserById, parseUserId, setUserStatus } from "@/lib/auth/admin-users";

/**
 * Single-user admin endpoint.
 *
 * `requireAdmin()` runs before the route parameter is even validated, so an
 * unauthenticated or non-admin caller cannot probe which ids exist.
 *
 * Only `status` is writable. There is no `role` field, no `email` field and no
 * `delete` verb: a caller cannot promote itself, cannot rewrite someone else's
 * email, and cannot remove rows. `authUserId` / `providerUserId` are never
 * selected, so no provider identifier or token is reachable through here.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }

  const { id } = await params;
  // Malformed id and non-existent id are both reported identically, so this
  // route cannot be used to enumerate valid user ids.
  if (!parseUserId(id)) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  try {
    const user = await getAdminUserById(id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json(
      { user },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    console.error("[admin] failed to load user:", error);
    return NextResponse.json({ error: "Failed to load user" }, { status: 500 });
  }
}

const PATCHABLE = new Set(["active", "suspended"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let adminId: string;
  try {
    adminId = (await requireAdmin()).id;
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }

  const { id } = await params;
  if (!parseUserId(id)) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;

  // Reject any attempt to change something other than status. Silently
  // ignoring `role` would be friendlier but much easier to get wrong.
  const attempted = Object.keys(record).filter(k => k !== "status");
  if (attempted.length > 0) {
    return NextResponse.json(
      { error: `Only 'status' is updatable. Rejected: ${attempted.join(", ")}` },
      { status: 400 }
    );
  }

  const status = record.status;
  if (typeof status !== "string" || !PATCHABLE.has(status)) {
    return NextResponse.json(
      { error: "'status' must be 'active' or 'suspended'" },
      { status: 400 }
    );
  }

  try {
    const user = await setUserStatus({
      userId: id,
      status: status as "active" | "suspended",
      actingAdminId: adminId,
    });
    return NextResponse.json(
      { user },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof ForbiddenError) {
      const notFound = error.message === "User not found";
      return NextResponse.json(
        { error: notFound ? "User not found" : error.message },
        { status: notFound ? 404 : 403 }
      );
    }
    console.error("[admin] failed to update user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}
