/**
 * Public rendering of the ISIC classification.
 *
 * IMPORTANT — there are two different codes on an activity and they are not
 * interchangeable:
 *
 *   - `isic_code`     the published ISIC Rev.4 section/division. This is the
 *                     only code that may appear on a public surface.
 *   - `activity_code` an internal, jurisdiction-specific catalogue code. It
 *                     exists to disambiguate similar activity names and to
 *                     score exact-code search matches. It is NOT an ISIC code,
 *                     it is not published by any authority, and it must never
 *                     be rendered, embedded in metadata, or returned by a
 *                     public API.
 *
 * This component only ever receives the ISIC value, so the internal code has
 * no path to the screen. Nothing here derives, normalizes or invents a code: a
 * missing value renders an explicit "not available" rather than a guess.
 */
export function IsicCode({
  code,
  className,
}: {
  code: string | null | undefined;
  className?: string;
}) {
  const value = code?.trim();

  if (!value) {
    return (
      <span className={className}>
        <span className="text-neutral-500">Not available</span>
      </span>
    );
  }

  return <span className={className}>{value}</span>;
}

/** Label + value pair for definition lists on the activity detail page. */
export function IsicCodeField({ code }: { code: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        ISIC code
      </dt>
      <dd className="mt-1 font-mono text-neutral-900">
        <IsicCode code={code} />
      </dd>
    </div>
  );
}
