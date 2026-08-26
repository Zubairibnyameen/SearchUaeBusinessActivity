import type { Metadata } from "next";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, jurisdictions } from "@/lib/db/schema";
import { formatEmirate, formatJurisdictionType } from "@/lib/format";

export const metadata: Metadata = {
  title: "Indexed UAE Jurisdictions",
  description:
    "Browse the UAE free zones and mainland authorities currently indexed in UAE Activity Intelligence: DMCC, IFZA, RAKEZ, SPC Free Zone and Ajman Free Zone.",
};

export const dynamic = "force-dynamic";

export default async function JurisdictionsPage() {
  const rows = await db
    .select({
      slug: jurisdictions.slug,
      name: jurisdictions.name,
      emirate: jurisdictions.emirate,
      type: jurisdictions.jurisdictionType,
      website: jurisdictions.officialWebsite,
      activityCount: sql<number>`COUNT(${activities.id})::int`,
    })
    .from(jurisdictions)
    .leftJoin(activities, eq(activities.jurisdictionId, jurisdictions.id))
    .where(eq(jurisdictions.status, "active"))
    .groupBy(
      jurisdictions.id,
      jurisdictions.slug,
      jurisdictions.name,
      jurisdictions.emirate,
      jurisdictions.jurisdictionType,
      jurisdictions.officialWebsite
    )
    .orderBy(jurisdictions.name);

  const indexed = rows.filter(r => r.activityCount > 0);
  const freeZones = indexed.filter(r => r.type === "free_zone");
  const mainlands = indexed.filter(r => r.type === "mainland");

  return (
    <div className="bg-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
            Indexed UAE Jurisdictions
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-600">
            Only authorities whose official activity publications have been
            imported and verified are listed here. Activity counts reflect the
            data captured from each authority&apos;s official source at
            verification time &mdash; they are not a claim about every activity
            the authority offers.
          </p>
        </header>

        {freeZones.length > 0 && (
          <>
            <h2 className="mb-4 mt-10 text-xs font-semibold uppercase tracking-widest text-neutral-400">
              Free Zones
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {freeZones.map(j => (
                <JurisdictionCard key={j.slug} j={j} />
              ))}
            </div>
          </>
        )}

        {mainlands.length > 0 && (
          <>
            <h2 className="mb-4 mt-10 text-xs font-semibold uppercase tracking-widest text-neutral-400">
              Mainland
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {mainlands.map(j => (
                <JurisdictionCard key={j.slug} j={j} />
              ))}
            </div>
          </>
        )}

        {indexed.length === 0 && (
          <div className="mt-8 rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center">
            <p className="text-sm text-neutral-500">
              No jurisdictions have been imported yet.
            </p>
          </div>
        )}

        <p className="mt-10 rounded-lg border border-neutral-200 bg-white p-4 text-xs leading-relaxed text-neutral-500">
          Additional UAE authorities will appear here only once their official
          activity data has been imported and verified. We do not list
          jurisdictions we have not verified data for.
        </p>
      </div>
    </div>
  );
}

function JurisdictionCard({
  j,
}: {
  j: {
    slug: string;
    name: string;
    emirate: string;
    type: string;
    website: string | null;
    activityCount: number;
  };
}) {
  return (
    <Link
      href={`/jurisdictions/${j.slug}`}
      className="group rounded-xl border border-neutral-200 bg-white p-5 transition-all hover:border-neutral-300 hover:shadow-md"
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        {formatJurisdictionType(j.type)}
      </span>
      <h3 className="mt-1 font-semibold text-neutral-900 transition-colors group-hover:text-blue-700">
        {j.name}
      </h3>
      <p className="mt-0.5 text-sm text-neutral-500">{formatEmirate(j.emirate)}</p>
      <p className="mt-3 text-xs font-medium tabular-nums text-neutral-500">
        {j.activityCount.toLocaleString()}{" "}
        {j.activityCount === 1 ? "activity" : "activities"} indexed
      </p>
    </Link>
  );
}
