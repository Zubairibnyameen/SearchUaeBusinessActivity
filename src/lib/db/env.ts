/**
 * `.env` loader for CLI scripts.
 *
 * Precedence matches the previous inline loaders: a value already present in
 * `process.env` always wins, so the invoking shell is never overridden by the
 * file.
 *
 * SECURITY — why `ALLOW_PROD_DB` is skipped:
 * `ALLOW_PROD_DB=1` authorizes writes to a production-like database. A `.env`
 * file is persistent configuration, not an invocation-time decision, so it must
 * never be able to opt a command into production writes. Only a value the
 * operator exported in the invoking shell (or the `--allow` flag) is honoured
 * by the DB-write gate in `src/scripts/db-safety.ts`. Any `ALLOW_PROD_DB` line
 * found in the file is therefore ignored here.
 */
import fs from "fs";
import path from "path";

export function loadEnvFile(
  envPath: string = path.join(process.cwd(), ".env")
): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && m[1] !== "ALLOW_PROD_DB" && !process.env[m[1]]) {
      process.env[m[1]] = m[2];
    }
  }
}
