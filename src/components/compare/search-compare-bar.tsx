"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

const MIN_SELECT = 2;

/**
 * Client-side jurisdiction comparison selector embedded in search results.
 * Lets users pick 2–4 matched jurisdictions and jump to /compare.
 * Does NOT add new jurisdictions — only makes existing matched ones selectable.
 */
export function SearchCompareBar({
  query,
  matchedJurisdictions,
}: {
  query: string;
  matchedJurisdictions: { slug: string; name: string }[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const router = useRouter();

  if (matchedJurisdictions.length < MIN_SELECT) return null;

  const toggle = (slug: string) => {
    const next = new Set(selected);
    if (next.has(slug)) {
      next.delete(slug);
    } else {
      if (next.size >= 4) return;
      next.add(slug);
    }
    setSelected(next);
  };

  const canCompare = selected.size >= MIN_SELECT;

  const goCompare = () => {
    if (!canCompare) return;
    const params = new URLSearchParams();
    params.set("q", query);
    params.set("jurisdictions", Array.from(selected).join(","));
    router.push(`/compare?${params.toString()}`);
  };

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-neutral-700">
            Compare jurisdictions
          </p>
          <p className="text-[11px] text-neutral-500">
            Select 2–4 matched jurisdictions to compare side by side
          </p>
        </div>
        <button
          type="button"
          disabled={!canCompare}
          onClick={goCompare}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold transition-colors",
            canCompare
              ? "bg-neutral-900 text-white hover:bg-neutral-700"
              : "cursor-not-allowed bg-neutral-100 text-neutral-500"
          )}
        >
          Compare{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {matchedJurisdictions.map(j => {
          const isSelected = selected.has(j.slug);
          return (
            <button
              key={j.slug}
              type="button"
              onClick={() => toggle(j.slug)}
              aria-pressed={isSelected}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                isSelected
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
              )}
            >
              {isSelected && (
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
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
      </div>
      {selected.size > 0 && selected.size < MIN_SELECT && (
        <p className="mt-2 text-[11px] text-neutral-500">
          Select at least {MIN_SELECT} jurisdictions to compare
        </p>
      )}
    </div>
  );
}
