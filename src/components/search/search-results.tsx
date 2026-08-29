import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SearchResultItem } from "@/lib/search/types";
import type { RegulatorySummary } from "@/lib/search/enrichment";
import {
  MatchTypeBadge,
  VerifiedBadge,
  ApprovalSignalBadgeSmall,
  ResearchRequiredBadge,
} from "@/components/ui/verification-badges";
import { formatAed, formatEmirate, formatJurisdictionType, titleCaseEnum } from "@/lib/format";

/**
 * Approval presentation is strictly 3-state:
 *  1. VERIFIED APPROVAL — from a verified approvals-table record.
 *  2. APPROVAL SIGNAL   — official source indicates third-party involvement;
 *                         explicitly NOT a verified approval.
 *  3. RESEARCH REQUIRED — no reliable conclusion either way.
 * A blank/absent signal must NEVER be presented as "No approval required".
 */
function ApprovalStatusCell({
  result,
  summary,
}: {
  result: SearchResultItem;
  summary?: RegulatorySummary;
}) {
  const verified = (summary?.verifiedApprovals.length ?? 0) > 0;
  if (verified) return <VerifiedBadge label="Verified approval" />;
  if (
    result.activity.approvalSignal === "third_party_approval_indicated" ||
    result.activity.approvalSignal === "may_be_required"
  )
    return <ApprovalSignalBadgeSmall />;
  return <ResearchRequiredBadge />;
}

/**
 * Match classification is the primary signal a reviewer needs to judge a
 * result quickly. Coloured left accent + badge make EXACT / STRONG / RELATED
 * distinguishable at a glance without exposing internal scoring details.
 */
const MATCH_ACCENT: Record<string, string> = {
  exact: "border-l-2 border-l-blue-600",
  strong: "border-l-2 border-l-indigo-500",
  related: "border-l-2 border-l-amber-400",
  low_confidence: "border-l-2 border-dashed border-l-neutral-300",
  ai_suggestion: "border-l-2 border-dashed border-l-violet-400",
};

function RelevanceMeter({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <span
      className="inline-flex items-center gap-1.5"
      aria-label={`Relevance ${pct}%`}
    >
      <span
        aria-hidden
        className="h-1.5 w-14 overflow-hidden rounded-full bg-neutral-200/80"
      >
        <span
          className="block h-full rounded-full bg-neutral-400"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-xs tabular-nums text-neutral-400">{pct}%</span>
    </span>
  );
}

export function SearchResultCard({
  result,
  summary,
  index = 0,
}: {
  result: SearchResultItem;
  summary?: RegulatorySummary;
  index?: number;
}) {
  const a = result.activity;
  const j = result.jurisdiction;
  const govFee = summary?.govFees[0];
  const tpc = summary?.thirdPartyCosts[0];

  return (
    <article
      className={cn(
        "group rounded-xl border border-neutral-200 bg-white p-5 transition-shadow hover:border-neutral-300 hover:shadow-md",
        index === 0
          ? `ring-1 ring-inset ring-neutral-100 ${MATCH_ACCENT[result.matchType] ?? ""}`
          : MATCH_ACCENT[result.matchType] ?? ""
      )}
    >
      {/* Header row: match badge + name + code */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <MatchTypeBadge matchType={result.matchType} />
            <RelevanceMeter score={result.matchScore} />
          </div>
          <h3 className="mt-2 text-base font-semibold leading-snug text-neutral-900">
            <Link
              href={`/activities/${a.id}`}
              className="transition-colors hover:text-blue-700"
            >
              {a.officialName}
            </Link>
          </h3>
          {a.activityCode && (
            <p className="mt-0.5 font-mono text-xs text-neutral-500">
              Code {a.activityCode}
            </p>
          )}
        </div>
        <Link
          href={`/activities/${a.id}`}
          className="shrink-0 self-center rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
          aria-hidden={false}
        >
          View details
        </Link>
      </div>

      {/* Context row: jurisdiction · emirate · FZ/mainland · licence */}
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Jurisdiction">
          <Link
            href={`/jurisdictions/${j.slug}`}
            className="font-medium text-neutral-800 hover:text-blue-700 hover:underline"
          >
            {j.name}
          </Link>
        </Field>
        <Field label="Emirate">{formatEmirate(j.emirate)}</Field>
        <Field label="Setup">{formatJurisdictionType(j.jurisdictionType)}</Field>
        <Field label="Licence type">
          {result.licenceType ? (
            result.licenceType.name
          ) : (
            <span className="text-neutral-400">Not specified in source</span>
          )}
        </Field>
      </dl>

      {/* Regulatory row: approval status + fees + costs */}
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-neutral-100 pt-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            Approval status
          </dt>
          <dd className="mt-1">
            <ApprovalStatusCell result={result} summary={summary} />
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            Government fee
          </dt>
          <dd className="mt-1 text-neutral-700">
            {govFee ? (
              <>
                <span className="font-semibold">{formatAed(govFee.amount)}</span>{" "}
                <span className="text-xs text-neutral-400">
                  ({titleCaseEnum(govFee.feeType)})
                </span>
              </>
            ) : (
              <span className="text-xs text-neutral-500">
                Not verified/published in indexed official sources.
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            Third-party cost
          </dt>
          <dd className="mt-1 text-neutral-700">
            {tpc ? (
              tpc.estimatedAmount !== null ? (
                formatAed(tpc.estimatedAmount)
              ) : (
                `${tpc.currency || ""} varies (${titleCaseEnum(tpc.costType)})`
              )
            ) : (
              <span className="text-xs text-neutral-500">Not verified</span>
            )}
          </dd>
        </div>
      </dl>

      {/* Match reason + provenance footer */}
      {(result.matchReasons.length > 0 || result.source) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-neutral-100 pt-3">
          {result.matchReasons.length > 0 && (
            <p className="text-xs text-neutral-400">
              Match reason: {result.matchReasons.join(" · ")}
            </p>
          )}
          {result.source?.url && (
            <a
              href={result.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-sky-700 hover:text-sky-900 hover:underline"
            >
              Official source ↗
            </a>
          )}
        </div>
      )}
      {!result.matchReasons.length && !result.source?.url && null}
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-neutral-700" title={typeof children === "string" ? children : undefined}>
        {children}
      </dd>
    </div>
  );
}