/**
 * Loading state for the admin tree.
 *
 * Every admin route is `force-dynamic` (the guard reads the session cookie) and
 * the dashboard alone fires ten concurrent aggregate queries, so every nav click
 * is a full server round trip. Without this boundary the browser shows a blank
 * white frame for the duration, which reads as "the admin area is broken" rather
 * than "it is loading".
 *
 * `app/error.tsx` is the sibling boundary that covers a failure, so the two
 * states are never confused.
 */
export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading admin page">
      {/* Mirrors the real page rhythm — title, then cards — so the layout does
          not jump when the content replaces the skeleton. */}
      <div className="h-8 w-56 max-w-full animate-pulse rounded-lg bg-neutral-200" />
      <div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded bg-neutral-200/70" />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-neutral-200 bg-white"
          />
        ))}
      </div>

      <div className="mt-8 h-64 animate-pulse rounded-xl border border-neutral-200 bg-white" />

      {/* Announced once, politely, rather than by three pulsing shapes. */}
      <p className="sr-only" role="status">
        Loading…
      </p>
    </div>
  );
}