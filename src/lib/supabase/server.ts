import "server-only";

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/**
 * Server-side Supabase client bound to the request's cookies.
 *
 * Every call this application makes with this client is authorized by the
 * END USER's own session token, which is the identity the application then
 * treats as authoritative. No service-role credential is used anywhere.
 *
 * Cookie writes are best-effort: `cookies().set()` only works inside a Route
 * Handler or Server Action. When called from a Server Component (which is the
 * common read path) Supabase will not be able to refresh the session there, so
 * the write is skipped rather than crashing the render.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Read-only cookie store (Server Component render). Session refresh
          // is handled by /auth/callback and /auth/signout, which are
          // Route Handlers with a writable store.
        }
      },
    },
  });
}
