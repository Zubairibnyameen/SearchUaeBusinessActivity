import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Trust / data-provenance badges.
 *
 * These are the ONLY sanctioned certainty labels across the product:
 *  - VERIFIED            — authoritative source confirms the claim
 *  - OFFICIAL SOURCE     — record originates from an official authority source
 *  - APPROVAL SIGNAL     — official listing indicates third-party involvement;
 *                          explicitly NOT a verified approval
 *  - RESEARCH REQUIRED   — no reliable conclusion yet (three-state model)
 *  - NOT VERIFIED        — claim exists but lacks authoritative confirmation
 *
 * Never exaggerate certainty. Absence of evidence must render as
 * RESEARCH REQUIRED or NOT VERIFIED — never as a negative ("not required").
 */

const BASE =
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide";

export function VerifiedBadge({ label = "Verified" }: { label?: string }) {
  return (
    <span className={cn(BASE, "border-emerald-200 bg-emerald-50 text-emerald-800")}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      </svg>
      {label}
    </span>
  );
}

export function ApprovalSignalBadgeSmall() {
  return (
    <span className={cn(BASE, "border-amber-200 bg-amber-50 text-amber-800")}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
      Approval signal
    </span>
  );
}

export function ResearchRequiredBadge({ label = "Research required" }: { label?: string }) {
  return (
    <span className={cn(BASE, "border-neutral-200 bg-neutral-50 text-neutral-500")}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
          clipRule="evenodd"
        />
      </svg>
      {label}
    </span>
  );
}

export function NotVerifiedBadge({ label = "Not verified" }: { label?: string }) {
  return (
    <span className={cn(BASE, "border-neutral-200 bg-white text-neutral-500")}>
      {label}
    </span>
  );
}

export function OfficialSourceBadge({ href, title }: { href?: string | null; title?: string | null }) {
  const inner = (
    <span className={cn(BASE, "border-sky-200 bg-sky-50 text-sky-700")}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
        <path
          fillRule="evenodd"
          d="M10 1c3.662 0 7 1.565 7 3.5V15.5c0 1.935-3.338 3.5-7 3.5s-7-1.565-7-3.5v-11C3 2.565 6.338 1 10 1zm0 2C6.857 3 5 4.057 5 4.5S6.857 6 10 6s5-1.057 5-1.5S13.143 3 10 3z"
          clipRule="evenodd"
        />
      </svg>
      Official source
    </span>
  );
  if (!href) return inner;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? undefined}
      className="transition-opacity hover:opacity-80"
    >
      {inner}
    </a>
  );
}

/**
 * Match-type badge. AI suggestions MUST look clearly distinct from official
 * records: dashed border + violet palette, labelled as generated suggestion.
 */
export function MatchTypeBadge({ matchType }: { matchType: string }) {
  switch (matchType) {
    case "exact":
      return (
        <span className={cn(BASE, "border-blue-200 bg-blue-50 text-blue-700")}>
          Exact match
        </span>
      );
    case "strong":
      return (
        <span className={cn(BASE, "border-indigo-200 bg-indigo-50 text-indigo-700")}>
          Strong match
        </span>
      );
    case "related":
      return (
        <span className={cn(BASE, "border-neutral-200 bg-neutral-50 text-neutral-600")}>
          Related activity
        </span>
      );
    case "low_confidence":
      return (
        <span className={cn(BASE, "border-dashed border-neutral-300 bg-white text-neutral-500")}>
          Low confidence
        </span>
      );
    case "ai_suggestion":
      return (
        <span className={cn(BASE, "border-dashed border-violet-300 bg-violet-50 text-violet-700")}>
          AI suggestion
        </span>
      );
    default:
      return (
        <span className={cn(BASE, "border-neutral-200 bg-neutral-50 text-neutral-500")}>
          {matchType.replace(/_/g, " ")}
        </span>
      );
  }
}

/**
 * Three-state approval presentation for detail surfaces.
 * A blank/absent signal must NEVER be presented as "No approval required".
 */
export function ApprovalStateBadge({
  verified,
  signal,
}: {
  verified: boolean;
  signal: string;
}) {
  if (verified) return <VerifiedBadge label="Verified approval" />;
  if (signal === "third_party_approval_indicated" || signal === "may_be_required")
    return <ApprovalSignalBadgeSmall />;
  return <ResearchRequiredBadge />;
}

/** Small pill linking to a jurisdiction page. */
export function JurisdictionPill({
  slug,
  name,
}: {
  slug: string;
  name: string;
}) {
  return (
    <Link
      href={`/jurisdictions/${slug}`}
      className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-xs font-medium text-neutral-600 transition-colors hover:border-neutral-300 hover:text-neutral-900"
    >
      {name}
    </Link>
  );
}
