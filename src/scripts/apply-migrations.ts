/**
 * Applies raw SQL migrations from src/lib/db/migrations in filename order.
 * Idempotent by design (IF NOT EXISTS everywhere applicable).
 *
 * Usage: npx tsx src/scripts/apply-migrations.ts
 */

import fs from "fs";
import path from "path";
import postgres from "postgres";
import { loadEnvFile } from "../lib/db/env";
import { assertDatabaseWritable } from "./db-safety";

async function main() {
  loadEnvFile();
  assertDatabaseWritable("apply-migrations");
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const migrationsDir = path.join(process.cwd(), "src", "lib", "db", "migrations");

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Found ${files.length} migration(s): ${files.join(", ")}`);

  for (const file of files) {
    const full = path.join(migrationsDir, file);
    const sqlText = fs.readFileSync(full, "utf-8");
    process.stdout.write(`Applying ${file} ... `);
    try {
      await client.unsafe(sqlText);
      console.log("OK");
    } catch (err: unknown) {
      console.log("FAILED");
      console.error(err instanceof Error ? err.message : err);
      await client.end();
      process.exit(1);
    }
  }

  // Verify index count
  const indexes = await client`
    SELECT tablename, indexname FROM pg_indexes
    WHERE schemaname = 'public' ORDER BY tablename, indexname`;
  console.log(`\nTotal indexes now: ${indexes.length}`);
  for (const i of indexes) {
    console.log(`  ${i.tablename}: ${i.indexname}`);
  }

  await client.end();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
