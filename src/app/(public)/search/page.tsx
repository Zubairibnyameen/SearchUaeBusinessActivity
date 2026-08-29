import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchBar } from "@/components/search/search-bar";
import { SearchResults } from "@/components/search/search-results-list";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;
  const query = q?.trim();
  if (!query) {
    return {
      title: "Search UAE Business Activities",
      description:
        "Search official UAE business activities across DMCC, IFZA, RAKEZ, SPC Free Zone and Ajman Free Zone. Find jurisdictions, licences, approvals and regulatory costs.",
      alternates: { canonical: "/search" },
    };
  }
  return {
    title: `"${query}" — UAE activity search results`,
    description: `Jurisdictions, licences, approval status and verified government fees for "${query}" across indexed UAE free zones and mainland authorities.`,
    alternates: { canonical: `/search?q=${encodeURIComponent(query)}` },
    robots: { index: false },
  };
}

export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  return (
    <div className="bg-neutral-50">
      <div className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <SearchBar compact />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <Suspense fallback={<SearchSkeleton />}>
          <SearchResults searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading results">
      <div className="h-10 w-full max-w-md animate-pulse rounded-lg bg-neutral-200/70" />
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="h-40 w-full animate-pulse rounded-xl border border-neutral-100 bg-white"
        />
      ))}
    </div>
  );
}
