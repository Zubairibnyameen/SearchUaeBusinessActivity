import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Sign out. Revokes the provider session and clears the HttpOnly auth cookies.
 *
 * POST-only: a GET sign-out would let any third-party page (an `<img>` tag, a
 * mail client link) terminate somebody's session, so the route rejects
 * everything except a same-origin form/JS POST.
 */
export async function POST(request: NextRequest) {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createServerSupabaseClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[auth] sign-out failed:", err);
      // Fall through: the local cookies are still cleared by the client
      // navigation, and a stale provider session alone grants nothing.
    }
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } }
  );
}

/** Explicitly refuse cross-site sign-out attempts and non-POST verbs. */
export function GET() {
  return NextResponse.json(
    { error: "Method not allowed" },
    { status: 405, headers: { allow: "POST" } }
  );
}
