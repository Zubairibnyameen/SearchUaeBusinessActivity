/**
 * Production configuration verification — READ-ONLY.
 *
 * Checks (without modifying any data or schema):
 *  1. Required environment is configured (presence only — never values).
 *  2. Application/build configuration files are present.
 *  3. Database is reachable (minimal safe query).
 *  4. Expected critical tables are available.
 *
 * SAFETY:
 *  - Performs only SELECT / information_schema reads. No INSERT/UPDATE/DELETE
 *    or DDL.
 *  - Never prints secrets or the full DATABASE_URL. It prints the database
 *    host category only (local vs remote).
 *
 * Usage: npm run verify
 */
import "dotenv/config";
import fs from "node:fs";

const LOCAL_HOST_RE = /^(localhost|127(\.\d{1,3}){3}|::1|0\.0\.0\.0|\[::1\])$/i;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

function present(name: string): boolean {
  const v = process.env[name];
  return Boolean(v && v.trim() && !/^change-this-to/i.test(v.trim()));
}

async function main() {
  const results: Check[] = [];
  let dbReachable = false;

  // 1. Required env configured (presence only)
  const required = ["DATABASE_URL"];
  const missingRequired = required.filter((n) => !present(n));
  results.push({
    name: "required env configured",
    ok: missingRequired.length === 0,
    detail:
      missingRequired.length === 0
        ? "all required variables present"
        : `missing or insecure: ${missingRequired.join(", ")}`,
  });

  // 2. Build/application config present
  const configFiles = ["next.config.ts", "tsconfig.json", "drizzle.config.ts", "package.json"];
  const missingFiles = configFiles.filter((f) => !fs.existsSync(f));
  results.push({
    name: "application build config present",
    ok: missingFiles.length === 0,
    detail:
      missingFiles.length === 0
        ? "next.config.ts, tsconfig.json, drizzle.config.ts, package.json present"
        : `missing: ${missingFiles.join(", ")}`,
  });

  // 3. Database reachable (minimal safe query) + host category (never the URL)
  let hostCategory = "unset";
  try {
    const url = process.env.DATABASE_URL ?? "";
    const host = new URL(url).hostname;
    hostCategory = host && LOCAL_HOST_RE.test(host) ? "local" : "remote";
  } catch {
    hostCategory = "unset";
  }

  if (!present("DATABASE_URL")) {
    results.push({
      name: "database reachable",
      ok: false,
      detail: "DATABASE_URL not configured (connectivity check skipped)",
    });
  } else {
    try {
      const { migrationClient } = await import("../lib/db");
      const rows = await migrationClient`select 1 as ok`;
      dbReachable = Array.isArray(rows) && rows.length === 1;
      results.push({
        name: "database reachable",
        ok: dbReachable,
        detail: dbReachable
          ? `reachable (host category: ${hostCategory})`
          : "connectivity query did not return the expected result",
      });
    } catch {
      results.push({
        name: "database reachable",
        ok: false,
        detail: `unreachable (host category: ${hostCategory})`,
      });
    }
  }

  // 4. Expected critical tables available (read-only information_schema query)
  const criticalTables = [
    "jurisdictions",
    "activities",
    "approvals",
    "approval_fees",
    "sources",
    "licence_types",
  ];
  if (dbReachable) {
    try {
      const { migrationClient } = await import("../lib/db");
      const rows = await migrationClient`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
      `;
      const presentSet = new Set(
        (rows as { table_name?: string }[]).map((r) => r.table_name)
      );
      const absent = criticalTables.filter((t) => !presentSet.has(t));
      const ok = absent.length === 0;
      results.push({
        name: "critical tables available",
        ok,
        detail: ok ? "all expected critical tables present" : `missing: ${absent.join(", ")}`,
      });
    } catch {
      results.push({
        name: "critical tables available",
        ok: false,
        detail: "could not query information_schema",
      });
    }
  } else {
    results.push({
      name: "critical tables available",
      ok: false,
      detail: "skipped (database not reachable)",
    });
  }

  // Output (never secrets, never the full DATABASE_URL)
  console.log("=== Production verification ===");
  let allOk = true;
  for (const r of results) {
    console.log(`  [${r.ok ? "OK" : "FAIL"}] ${r.name} — ${r.detail}`);
    if (!r.ok) allOk = false;
  }
  console.log(allOk ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(allOk ? 0 : 1);
}

main().catch(() => {
  console.error("verify: unexpected failure (no secrets logged)");
  process.exit(1);
});
