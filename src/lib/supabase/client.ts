/**
 * Browser Supabase client.
 *
 * SAFE TO IMPORT FROM CLIENT CODE — it only ever receives the public project
 * URL and the publishable/anon key from `@/lib/supabase/config`. No
 * service-role credential is imported, read or bundled here, and the session
 * is persisted in cookies by `@supabase/ssr` so the server components see the
 * exact same session.
 */
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from "./config";

/**
 * Returns the browser client, or `null` when Supabase is not configured.
 *
 * Callers must handle `null`: a missing configuration is a deployment problem,
 * not a crash. Throwing here would take down the whole page instead of
 * degrading to a "login unavailable" state.
 */
export function createBrowserSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
