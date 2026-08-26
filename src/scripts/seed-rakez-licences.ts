/**
 * Tops up the seeded RAKEZ jurisdiction with its full licence-type taxonomy
 * as published in the official activity-list filter (11 types).
 * Idempotent — safe to re-run; adds only missing types.
 *
 * Usage: npx tsx src/scripts/seed-rakez-licences.ts
 */

import fs from "fs";
import path from "path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { jurisdictions, licenceTypes } from "../lib/db/schema";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// Verbatim labels from rakez.com activity list filter + stable local codes.
const RAKEZ_LICENCES = [
  { label: "Industrial", code: "IND" },
  { label: "Commercial", code: "COM" },
  { label: "Educational", code: "EDU" },
  { label: "Services", code: "SRV" },
  { label: "Professional", code: "PRO" },
  { label: "Business Invest", code: "BIN" },
  { label: "Individual / Professional", code: "IPR" },
  { label: "E-Commerce", code: "ECO" },
  { label: "General Trading", code: "GTR" },
  { label: "Media", code: "MED" },
  { label: "Freelance Permit", code: "FRE" },
];

async function main() {
  loadEnv();
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);

  const [jur] = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.slug, "rakez"))
    .limit(1);
  if (!jur) throw new Error("Jurisdiction 'rakez' not found — cannot proceed");

  const existing = await db
    .select()
    .from(licenceTypes)
    .where(eq(licenceTypes.jurisdictionId, jur.id));
  console.log(`Existing licence types: ${existing.length}`);

  let added = 0;
  for (const l of RAKEZ_LICENCES) {
    const name = `${l.label} Licence`;
    const dupe = existing.find(
      (e) => e.code === l.code || e.name.toLowerCase() === name.toLowerCase()
    );
    if (dupe) continue;
    await db.insert(licenceTypes).values({
      jurisdictionId: jur.id,
      name,
      code: l.code,
      description: `RAKEZ ${l.label} licence classification (official activity-list filter)`,
    });
    added += 1;
    console.log(`Added: [${l.code}] ${name}`);
  }
  console.log(`Added ${added} licence type(s)`);

  // Verify
  const check = await client`
    SELECT lt.code, lt.name FROM licence_types lt
    JOIN jurisdictions j ON j.id = lt.jurisdiction_id
    WHERE j.slug = 'rakez' ORDER BY lt.code`;
  console.log("Verify:", JSON.stringify(check));

  await client.end();
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
