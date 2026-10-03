"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Sign out of the admin area.
 *
 * Ends the real Supabase session via `POST /auth/signout` — there is no
 * separate admin credential to clear, because the admin area has no separate
 * authentication system.
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /*
   * `pending` only covers the navigation that follows a successful sign-out, so
   * it cannot stop a second click while the request is still in flight. `busy`
   * covers the fetch itself; disabling on either keeps a double-click from
   * firing two sign-out requests.
   */
  async function handleLogout() {
    if (busy || pending) return;
    setFailed(false);
    setBusy(true);
    try {
      const res = await fetch("/auth/signout", { method: "POST" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
    } catch {
      // Network failure: do not navigate away, or the user lands on a page that
      // still believes they are signed in.
      setFailed(true);
      return;
    } finally {
      setBusy(false);
    }
    startTransition(() => {
      router.push("/signin");
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      <button
        onClick={handleLogout}
        disabled={busy || pending}
        aria-busy={busy || pending}
        className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        {busy || pending ? "Signing out…" : "Sign out"}
      </button>
      {failed && (
        <p className="mt-1 px-3 text-xs text-red-600">
          Sign out failed. Please try again.
        </p>
      )}
    </div>
  );
}
