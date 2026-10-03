"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Revoke the caller's provider session and clear the HttpOnly session cookies.
 *
 * Rendered as a form action on /account, so it is a same-origin POST with a
 * Next.js server-action id — a cross-site request cannot forge it.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  try {
    await supabase.auth.signOut();
  } catch (error) {
    // The local cookies are cleared by the Supabase client's error handling.
    // Surface the failure rather than pretending the session is gone.
    console.error("[auth] sign-out failed:", error);
    throw new Error("Sign out failed. Please try again.");
  }
}
