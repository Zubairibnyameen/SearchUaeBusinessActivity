/**
 * Runtime database-write safety gate for CLI scripts.
 *
 * Mutating scripts (migrations, seeds, imports, backfills) MUST call
 * `assertDatabaseWritable(command)` after loading env and BEFORE opening a
 * connection or executing any write. It reuses the same pure decision logic as
 * the `db-guard` CLI wrapper (src/scripts/db-guard.ts): local hosts are allowed;
 * a production-like (remote) host is blocked unless the operator opts in with
 * ALLOW_PROD_DB=1 or --allow.
 *
 * This never connects to or mutates a database itself — it is a gate only, and
 * it never prints the DATABASE_URL (only the host category).
 */
import { classifyHost, decideGuard } from "../lib/db/guard";

export function isProdOptIn(argv: string[] = process.argv): boolean {
  return argv.includes("--allow") || process.env.ALLOW_PROD_DB === "1";
}

export function assertDatabaseWritable(
  command: string,
  argv: string[] = process.argv
): void {
  const url = process.env.DATABASE_URL;
  const cat = classifyHost(url);

  if (cat === "unset") {
    console.error(
      `[db-guard] DATABASE_URL is not set. Refusing to run "${command}".`
    );
    process.exit(1);
  }

  const decision = decideGuard(url, isProdOptIn(argv));
  const hint = cat === "local" ? "local" : "remote/hosted";

  if (decision.allowed && cat === "local") {
    console.log(`[db-guard] ${command}: allowed (database host is ${hint}).`);
    return;
  }

  if (decision.allowed) {
    console.warn(
      `[db-guard] ${command}: PRODUCTION-LIKE host (${hint}) but ALLOW_PROD_DB=1 is set — running anyway.`
    );
    return;
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
