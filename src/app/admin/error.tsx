"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Error boundary scoped to the admin tree.
 *
 * WHY THIS EXISTS
 *   Without it, a thrown error anywhere under `/admin` was caught by the ROOT
 *   `app/error.tsx`, which replaces the entire document. An admin who hit one
 *   error lost the sidebar, the signed-in-as panel and — most importantly — the
 *   Sign out button, with no way back except the browser's back button or the
 *   public header.
 *
 *   An `error.tsx` placed here keeps `admin/layout.tsx` mounted, so the
 *   navigation and sign-out survive the failure. That is the whole point.
 *
 * SERVER DETAIL IS NEVER SHOWN
 *   `error.message` and `error.digest` are deliberately not rendered. `message`
 *   for a server-side failure carries driver and internal detail; the digest is
 *   an opaque id that means nothing to an admin and could be used to correlate
 *   requests. Both go to the console for the operator instead, and the admin sees
 *   a retry.
 */

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Operator-side only. Never rendered into the page.
    console.error("[admin] page error:", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-8 text-center"
    >
      <h1 className="text-lg font-semibold text-red-900">
        This admin page could not be loaded
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-red-800">
        Something failed while preparing this page. The rest of the admin area is
        still available from the navigation.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
        >
          Try again
        </button>
        <Link
          href="/admin"
          className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-900 transition-colors hover:bg-red-100"
        >
          Admin dashboard
        </Link>
      </div>
    </div>
  );
}