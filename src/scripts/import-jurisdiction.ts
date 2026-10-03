/**
 * Unified ingestion runner.
 *
 * Usage: npx tsx src/scripts/import-jurisdiction.ts <slug> [--dry-run] [--backfill-signals]
 *
 * --backfill-signals: idempotently backfill approval signals onto ALREADY
 * imported activities (source records + activity_approval_signals upserted,
 * activities updated). Nothing is duplicated on re-runs.
 *
 * Adapters are registered explicitly; missing ones fail fast with a clear
 * message instead of silently importing nothing.
 */

import fs from "fs";
import path from "path";
import { runImport } from "../lib/ingestion/importer";
import {
  IMPORTABLE_SOURCES,
  KNOWN_SOURCE_SLUGS,
  loadAdapterFor,
} from "../lib/ingestion/registry";

async function main() {
  const slug = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  const backfillSignals = process.argv.includes("--backfill-signals");

  if (!slug) {
    console.error(
      "Usage: npx tsx src/scripts/import-jurisdiction.ts <slug> [--dry-run] [--backfill-signals]"
    );
    console.error(`Available: ${IMPORTABLE_SOURCES.map(s => s.slug).join(", ")}`);
    process.exit(1);
  }


  console.log(
    `Running import for '${slug}'${dryRun ? " (DRY RUN)" : ""}${backfillSignals ? " (BACKFILL SIGNALS)" : ""}\n`
  );

  try {
    const adapter = await loadAdapterFor(slug);
    const report = await runImport(adapter, { dryRun, backfillSignals });

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
  } catch (e) {
    // A slug we recognise gets its own message ("ingestion has not been
    // approved yet"); anything else is a run-level failure.
    const message = e instanceof Error ? e.message : String(e);
    console.error(
      KNOWN_SOURCE_SLUGS.includes(slug) ? message : `Import failed: ${message}`
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Import failed:", e);
  process.exit(1);
});
