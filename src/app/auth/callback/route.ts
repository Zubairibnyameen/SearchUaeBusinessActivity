import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAuthIdentity, syncSignedInProfile } from "@/lib/auth/viewer";
import { safeNextPath } from "@/lib/auth/redirects";

// Runs on every request: the session is validated by the provider and cookies
// are rewritten, so this route can never be statically cached.
export const dynamic = "force-dynamic";

/**
 * OAuth redirect target. Exchanges the short-lived PKCE `code` for a session
 * on the server, so the session tokens are written straight into HttpOnly
 * cookies and are never exposed to client-side JavaScript.
 */
export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const code = request.nextUrl.searchParams.get("code");

  const failTo = (reason: string) =>
    NextResponse.redirect(new URL(`/signin?error=${reason}`, request.url));

  if (!isSupabaseConfigured()) return failTo("unconfigured");
  if (!code) return failTo("missing_code");

  /*
   * ORIGIN DISCIPLINE: `new URL(next, request.url)` resolves the relative path
   * against the request's own URL, which Next derives from the incoming
   * connection rather than from anything a caller can put in a header we read.
   * No `Host` or `X-Forwarded-Host` is consulted here, and no origin is
   * hardcoded — so a local sign-in returns to localhost and a deployed one
   * returns to the deployment, with no environment branch.
   *
   * `next` is constrained to a same-origin relative path by `safeNextPath`
   * above, so the resolved URL cannot leave this site even though the base is
   * the request URL.
   */

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth] code exchange failed:", error.message);
      return failTo("exchange_failed");
    }

    // Project the verified identity into app_users.
    //
    // DELIBERATELY ISOLATED IN ITS OWN try/catch. A failure here must not strand
    // somebody who has just proved who they are: the session is already valid,
    // and authorization for the admin area is re-checked on every admin request
    // regardless. Letting the rejection reach the outer catch would bounce a
    // successful Google sign-in to `/signin?error=unexpected` over a transient
    // database hiccup — which is how a valid session ends up looking like a
    // failed sign-in.
    try {
      const identity = await getAuthIdentity();
      if (identity) {
        await syncSignedInProfile(identity);
      }
    } catch (projectionError) {
      console.error("[auth] profile projection failed:", projectionError);
    }

    return NextResponse.redirect(new URL(next, request.url));
  } catch (err) {
    console.error("[auth] callback error:", err);
    return failTo("unexpected");
  }
}
