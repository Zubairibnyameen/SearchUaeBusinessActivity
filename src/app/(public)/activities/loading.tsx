export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10" aria-busy="true" aria-label="Loading activities">
      <div className="h-8 w-64 animate-pulse rounded bg-neutral-200/70" />
      {/* `flex-wrap`: four fixed 96px chips are 408px wide, wider than any
          phone viewport, so an unwrapped row pushed the page sideways. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-7 w-24 animate-pulse rounded-full bg-neutral-200/70" />
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="h-16 w-full animate-pulse rounded-xl border border-neutral-100 bg-white" />
        ))}
      </div>
    </div>
  );
}