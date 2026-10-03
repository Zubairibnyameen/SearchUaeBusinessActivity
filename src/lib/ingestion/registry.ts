/**
 * The single registry of importable official sources.
 *
 * Both entry points read this list: the CLI runner
 * (`src/scripts/import-jurisdiction.ts`) and /admin/import. There is
 * deliberately no second copy — a source that is importable from the command
 * line but not from the admin UI (or the reverse) would be a trap.
 *
 * Adapters are behind lazy `load()` thunks so that listing the sources on a page
 * never pulls `exceljs` and the adapters into the render path. Nothing here adds
 * a jurisdiction: the not-approved stubs exist so an unsupported slug fails with
 * a clear message instead of importing nothing.
 */

import type { OfficialActivitySourceAdapter, SourceFormat } from "./types";

export interface ImportableSource {
  /** Matches `SourceMetadata.jurisdictionSlug` and the seeded `jurisdictions.slug`. */
  slug: string;
  /** Shown in the admin UI. */
  label: string;
  /** The publishing authority, shown so the reviewer knows what they are trusting. */
  authorityName: string;
  authorityWebsite?: string;
  /** File formats an admin upload may use for this source. */
  formats: readonly SourceFormat[];
  load: () => Promise<OfficialActivitySourceAdapter>;
}

export const IMPORTABLE_SOURCES: readonly ImportableSource[] = [
  {
    slug: "dmcc",
    label: "DMCC — Licence Activity list",
    authorityName: "Dubai Multi Commodities Centre",
    authorityWebsite: "https://www.dmcc.com/",
    formats: ["xlsx"],
    load: async () => (await import("./adapters/dmcc")).dmccAdapter,
  },
  {
    slug: "rakez",
    label: "RAKEZ — Activity master file",
    authorityName: "Ras Al Khaimah Economic Zone",
    authorityWebsite: "https://rakez.com/",
    formats: ["xlsx"],
    load: async () => (await import("./adapters/rakez")).rakezAdapter,
  },
  {
    slug: "ifza",
    label: "IFZA — Business Activities register",
    authorityName: "International Free Zone Authority",
    authorityWebsite: "https://www.ifza.com/",
    formats: ["json"],
    load: async () => (await import("./adapters/ifza")).ifzaAdapter,
  },
  {
    slug: "afz",
    label: "Ajman Free Zone — Activity list",
    authorityName: "Ajman Free Zone Authority",
    authorityWebsite: "https://afz.gov.ae/",
    formats: ["html"],
    load: async () => (await import("./adapters/afz")).afzAdapter,
  },
  {
    slug: "spc",
    label: "SPC — Free Zone activity list",
    authorityName: "Sharjah Publishing City",
    authorityWebsite: "https://spcfreezone.ae/",
    formats: ["json"],
    load: async () => (await import("./adapters/spc")).spcAdapter,
  },
] as const;

/**
 * Sources that are known but not approved for ingestion. Kept as data (rather
 * than absent) so both entry points can tell an admin "this jurisdiction is not
 * supported yet" instead of "unknown jurisdiction".
 */
export const NOT_APPROVED_SOURCES: readonly { slug: string; label: string }[] = [
  { slug: "shams", label: "SHAMS Free Zone" },
  { slug: "jafza", label: "JAFZA (Jebel Ali Free Zone)" },
  { slug: "meydan", label: "Meydan Free Zone" },
] as const;

/** Every slug the tool knows about, for error messages. */
export const KNOWN_SOURCE_SLUGS: readonly string[] = [
  ...IMPORTABLE_SOURCES.map(s => s.slug),
  ...NOT_APPROVED_SOURCES.map(s => s.slug),
];

export function findImportableSource(slug: string): ImportableSource | undefined {
  return IMPORTABLE_SOURCES.find(s => s.slug === slug);
}

/**
 * Load an adapter for `slug`.
 *
 * Throws for an unknown slug and for a known-but-unapproved one, with messages
 * that name the difference. Callers surface these to the admin; neither reveals
 * anything about the database.
 */
export async function loadAdapterFor(
  slug: string
): Promise<OfficialActivitySourceAdapter> {
  const source = findImportableSource(slug);
  if (source) return source.load();

  const notApproved = NOT_APPROVED_SOURCES.find(s => s.slug === slug);
  if (notApproved) {
    throw new Error(
      `${notApproved.label} ingestion has not been approved yet. Do not add new jurisdictions until explicitly instructed.`
    );
  }
  throw new Error(
    `Unknown source '${slug}'. Supported: ${IMPORTABLE_SOURCES.map(s => s.slug).join(", ")}.`
  );
}