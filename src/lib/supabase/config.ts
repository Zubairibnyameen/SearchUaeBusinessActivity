/**
 * Supabase public configuration.
 *
 * SAFE TO IMPORT FROM CLIENT CODE.
 *
 * Only the project URL and the *publishable / anon* key belong here. Both are
 * designed by Supabase to be publicly readable — the anon key grants nothing
 * on its own; every request is authorized by the end-user's own session token
 * plus row-level security.
 *
 * The SERVICE ROLE key is deliberately absent from this codebase's client
 * surface and is not read at all: the application never needs it, because the
 * user profile it manages lives in our own PostgreSQL database and is written
 * server-side using the signed-in user's verified identity.
 */

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const rawAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const SUPABASE_URL = (rawUrl ?? "").trim();
export const SUPABASE_ANON_KEY = (rawAnonKey ?? "").trim();

/** True when Google login is wired up. Never throws, never logs secrets. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}
