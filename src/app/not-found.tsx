import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">
        404
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-neutral-900">
        Page not found
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-600">
        The page, activity or jurisdiction you are looking for does not exist in
        the index.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
        >
          Back to home
        </Link>
        <Link
          href="/search"
          className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          Search activities
        </Link>
      </div>
    </main>
  );
}
