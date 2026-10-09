/**
 * Database safety guard for CLI scripts (tsx scripts/db-guard.ts <command>).
 *
 * SAFETY RATIONALE
 * This project keeps a manually-maintained, forward-only set of SQL migrations
 * (see src/lib/db/migrations/*.sql) because the Drizzle migration journal was
 * never established. db:push / db:seed / db:migrate are DEV tools that can
 * destructively mutate the schema, so they MUST NOT run against a non-local
 * (production-like / Neon) database unless explicitly allowed.
 *
 * Never performs any schema/data mutation itself — this is a gate only.
 */
import { loadEnvFile } from "../lib/db/env";
import { classifyHost, decideGuard } from "../lib/db/guard";

// Loads `.env` but deliberately never lets a file-sourced ALLOW_PROD_DB opt
// into production writes — see src/lib/db/env.ts.
loadEnvFile();

const command = process.argv[2] ?? "db:push";
const flaggedProd = process.argv.includes("--allow") || process.env.ALLOW_PROD_DB === "1";

function main(): void {
  const url = process.env.DATABASE_URL;
  const cat = classifyHost(url);

  if (cat === "unset") {
    console.error(
      "[db-guard] DATABASE_URL is not set. Refusing to run a database command."
    );
    process.exit(1);
  }

  const decision = decideGuard(url, flaggedProd);
  const hint = cat === "local" ? "local" : "remote/hosted";

  if (decision.allowed && cat === "local") {
    console.log(`[db-guard] ${command}: allowed (database host is ${hint}).`);
    process.exit(0);
  }

  if (decision.allowed) {
    console.warn(
      `[db-guard] ${command}: PRODUCTION-LIKE host (${hint}) but ALLOW_PROD_DB=1 is set — running anyway.`
    );
    process.exit(0);
  }

  console.error(
    `[db-guard] BLOCKED: "${command}" targets a production-like database host (${hint}).\n` +
      `  This is a potentially destructive/dev command and will not run against production.\n` +
      `  If you are certain, pass --allow (or export ALLOW_PROD_DB=1 in the invoking\n` +
      `  shell) — but verify you are pointing at the correct sandbox/staging database\n` +
      `  first. A value only present in .env is intentionally ignored.`
  );
  process.exit(1);
}

main();
