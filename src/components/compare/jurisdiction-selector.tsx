"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const MIN = 2;
const MAX = 4;

/**
 * Interactive 2–4 jurisdiction selector for the comparison tool.
 * Keeps the selection in the URL so comparisons are shareable/deep-linkable.
 * Min/max bounds are enforced client-side and re-clamped server-side.
 */
export function JurisdictionSelector({
  jurisdictions,
  selected,
  query,
}: {
  jurisdictions: { slug: string; name: string }[];
  selected: string[];
  query: string;
}) {
  const [selection, setSelection] = useState<string[]>(selected);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const selectedSet = new Set(selection);

  const toggle = (slug: string) => {
    const next = new Set(selectedSet);
    if (next.has(slug)) {
      if (next.size <= MIN) return;
      next.delete(slug);
    } else {
      if (next.size >= MAX) return;
      next.add(slug);
    }
    const list = jurisdictions
      .filter(j => next.has(j.slug))
      .map(j => j.slug);
    setSelection(list);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    params.set("jurisdictions", list.join(","));
    startTransition(() => {
      router.push(`/compare?${params.toString()}`);
    });
  };

  if (jurisdictions.length <= 1) return null;

  return (
    <fieldset>
      <legend className="text-xs font-medium uppercase tracking-widest text-neutral-400">
        Compare jurisdictions&nbsp;
        <span aria-hidden>
          ({selection.length} of {jurisdictions.length})
        </span>
      </legend>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {jurisdictions.map(j => {
          const isSelected = selectedSet.has(j.slug);
          const deselectDisabled = isSelected && selection.length <= MIN;
          const selectDisabled = !isSelected && selection.length >= MAX;
          const disabled = isPending || deselectDisabled || selectDisabled;
          return (
            <button
              key={j.slug}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              aria-disabled={disabled}
              onClick={() => toggle(j.slug)}
              title={
                deselectDisabled
                  ? `Select at least ${MIN} jurisdictions`
                  : selectDisabled
                    ? `Select at most ${MAX} jurisdictions`
                    : isSelected
                      ? `Remove ${j.name} from comparison`
                      : `Add ${j.name} to comparison`
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30",
                isSelected
                  ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900",
                disabled && !isSelected && "cursor-not-allowed opacity-50 hover:border-neutral-200 hover:text-neutral-600",
                disabled && isSelected && "cursor-not-allowed opacity-60"
              )}
            >
              {isSelected && (
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              {j.name}
            </button>
          );
        })}
        <span className="text-xs text-neutral-400" aria-live="polite">
          Select {MIN}–{MAX} jurisdictions.
        </span>
      </div>
    </fieldset>
  );
}