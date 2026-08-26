"use client";

import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-600">
        An unexpected error occurred while rendering this page. You can retry,
        or return home.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-neutral-400">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
