import { cn } from "@/lib/utils";
import { resolvePrimaryIdentifier } from "@/lib/activities/identifier";

/**
 * Jurisdiction-aware primary identifier label + value.
 *
 *   AFZ        → `ISIC Code 4690018`
 *   Other      → `License Number DMCC-0001`
 *
 * When the required identifier is genuinely missing the component renders
 * nothing: no invented value and no placeholder that could be mistaken for a
 * real identifier.
 */
export function PrimaryIdentifier({
  jurisdictionSlug,
  isicCode,
  activityCode,
  className,
}: {
  jurisdictionSlug: string | null | undefined;
  isicCode?: string | null;
  activityCode?: string | null;
  className?: string;
}) {
  const identifier = resolvePrimaryIdentifier({
    jurisdictionSlug,
    isicCode,
    activityCode,
  });
  if (!identifier.value) return null;
  return (
    <span className={cn("text-xs text-neutral-500", className)}>
      {identifier.label}{" "}
      <span className="font-mono text-neutral-700">{identifier.value}</span>
    </span>
  );
}