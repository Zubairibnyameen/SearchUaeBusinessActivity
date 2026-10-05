export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10" aria-busy="true" aria-label="Loading">
      {/* `w-full max-w-72`: a bare `w-72` is 288px, wider than the 272px content
          box left by `px-6` on a 320px screen. */}
      <div className="h-8 w-full max-w-72 animate-pulse rounded bg-neutral-200/70" />
      <div className="mt-6 space-y-4">
        {[0,1,2].map(i => (
          <div key={i} className="h-32 w-full animate-pulse rounded-xl border border-neutral-100 bg-white" />
        ))}
      </div>
    </div>
  );
}
