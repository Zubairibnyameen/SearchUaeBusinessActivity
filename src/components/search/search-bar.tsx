"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export function SearchBar({ compact = false }: { compact?: boolean }) {
  const [query, setQuery] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) {
      router.push(`/search?q=${encodeURIComponent(q)}`);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      aria-label="Activity search"
      className={cn("mx-auto w-full", compact ? "max-w-3xl" : "max-w-2xl")}
    >
      <div
        className={cn(
          "group flex items-center gap-2 rounded-xl border border-neutral-300 bg-white p-1.5 shadow-sm transition-all focus-within:border-neutral-400 focus-within:shadow-md",
          !compact && "sm:p-2"
        )}
      >
        <span className="pointer-events-none flex shrink-0 items-center pl-2 text-neutral-400">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={compact ? "h-4 w-4" : "h-5 w-5"}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </span>
        <label htmlFor="activity-search" className="sr-only">
          What business activity do you want to start?
        </label>
        <input
          id="activity-search"
          type="text"
          autoComplete="off"
          placeholder="What business activity do you want to start?"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className={cn(
            "min-w-0 flex-1 bg-transparent font-normal text-neutral-900 placeholder:text-neutral-400 focus:outline-none",
            compact ? "px-1 py-2 text-sm" : "px-2 py-2.5 text-base sm:text-lg"
          )}
        />
        <button
          type="submit"
          className={cn(
            "shrink-0 rounded-lg bg-neutral-900 font-semibold text-white transition-colors hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30",
            compact ? "px-4 py-2 text-sm" : "px-6 py-3 text-sm sm:text-base"
          )}
        >
          Search
        </button>
      </div>
    </form>
  );
}
