/**
 * Unified ingestion runner.
 *
 * Usage: npx tsx src/scripts/import-jurisdiction.ts <slug> [--dry-run]
 *
 * Adapters are registered explicitly; missing ones fail fast with a clear
 * message instead of silently importing nothing.
 */

import fs from "fs";
import path from "path";
import { runImport } from "../lib/ingestion/importer";
import { dmccAdapter } from "../lib/ingestion/adapters/dmcc";
import type { OfficialActivitySourceAdapter } from "../lib/ingestion/types";

interface AdapterModule {
  [key: string]: unknown;
}

const ADAPTERS: Record<string, () => Promise<AdapterModule>> = {
  dmcc: async () => ({ dmccAdapter }),
  afz: () => import("../lib/ingestion/adapters/afz"),
  spc: () => import("../lib/ingestion/adapters/spc"),
  rakez: () => import("../lib/ingestion/adapters/rakez"),
  ifza: () => import("../lib/ingestion/adapters/ifza"),
  shams: async () => ({
    shamsAdapter: notApprovedStub("shams", "SHAMS Free Zone"),
  }),
  jafza: async () => ({
    jafzaAdapter: notApprovedStub("jafza", "JAFZA (Dubai Multi Commodities?) Jebel Ali Free Zone"),
  }),
  meydan: async () => ({
    meydanAdapter: notApprovedStub("meydan", "Meydan Free Zone"),
  }),
};

/** Fail-fast stub for jurisdictions whose ingestion is not yet approved. */
function notApprovedStub(slug: string, name: string) {
  return {
    meta: { jurisdictionSlug: slug, jurisdictionName: name },
    async discover() {
      throw new Error(
        `${name} ingestion has not been approved yet. Do not add new jurisdictions until explicitly instructed.`
      );
    },
  };
}

async function main() {
  const slug = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!slug) {
    console.error("Usage: npx tsx src/scripts/import-jurisdiction.ts <slug> [--dry-run]");
    console.error(`Available: ${Object.keys(ADAPTERS).join(", ")}`);
    process.exit(1);
  }

  const loader = ADAPTERS[slug];
  if (!loader) {
    console.error(`Unknown jurisdiction '${slug}'. Available: ${Object.keys(ADAPTERS).join(", ")}`);
    process.exit(1);
  }

  const mod: AdapterModule = await loader();
  const adapterKey = Object.keys(mod).find((k) => k.toLowerCase().includes("adapter"));
  if (!adapterKey || !mod[adapterKey]) {
    console.error(`Adapter not built yet for '${slug}'.`);
    process.exit(1);
  }

  console.log(`Running import for '${slug}'${dryRun ? " (DRY RUN)" : ""}\n`);
  const adapter = mod[adapterKey] as OfficialActivitySourceAdapter;
  const report = await runImport(adapter, { dryRun });

  // Persist machine-readable report
  const outDir = path.join(process.cwd(), "data", "reports", slug);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(
    outDir,
    `import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${path.relative(process.cwd(), outFile)}`);

  if (report.errors.length > 0 || report.counters.imported === 0) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error("Import failed:", e);
  process.exit(1);
});
