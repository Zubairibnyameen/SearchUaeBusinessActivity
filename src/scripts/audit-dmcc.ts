/**
 * Data Quality Audit for DMCC import
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { activities, activitySynonyms, sources, jurisdictions, licenceTypes } from "../lib/db/schema";
import { eq, count, sql, and, isNull, isNotNull } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

interface AuditResult {
  category: string;
  check: string;
  status: "PASS" | "WARN" | "FAIL";
  count: number;
  details: string;
}

async function runAudit(): Promise<AuditResult[]> {
  const results: AuditResult[] = [];

  // Get DMCC jurisdiction ID
  const [dmcc] = await db
    .select({ id: jurisdictions.id })
    .from(jurisdictions)
    .where(eq(jurisdictions.slug, "dmcc"))
    .limit(1);

  if (!dmcc) {
    results.push({
      category: "Setup",
      check: "DMCC jurisdiction exists",
      status: "FAIL",
      count: 0,
      details: "DMCC jurisdiction not found",
    });
    return results;
  }

  // 1. Completeness checks
  const [totalCount] = await db
    .select({ value: count() })
    .from(activities)
    .where(eq(activities.jurisdictionId, dmcc.id));

  results.push({
    category: "Completeness",
    check: "Total activities imported",
    status: "PASS",
    count: totalCount.value,
    details: `Expected ~1007, got ${totalCount.value}`,
  });

  // Activities missing codes
  const [missingCodes] = await db
    .select({ value: count() })
    .from(activities)
    .where(
      and(
        eq(activities.jurisdictionId, dmcc.id),
        isNull(activities.activityCode)
      )
    );

  results.push({
    category: "Completeness",
    check: "Activities with codes",
    status: missingCodes.value === 0 ? "PASS" : "WARN",
    count: totalCount.value - missingCodes.value,
    details: `${missingCodes.value} activities missing codes`,
  });

  // Activities missing descriptions
  const [missingDescriptions] = await db
    .select({ value: count() })
    .from(activities)
    .where(
      and(
        eq(activities.jurisdictionId, dmcc.id),
        isNull(activities.description)
      )
    );

  results.push({
    category: "Completeness",
    check: "Activities with descriptions",
    status: missingDescriptions.value === 0 ? "PASS" : "WARN",
    count: totalCount.value - missingDescriptions.value,
    details: `${missingDescriptions.value} activities missing descriptions`,
  });

  // Activities missing categories
  const [missingCategories] = await db
    .select({ value: count() })
    .from(activities)
    .where(
      and(
        eq(activities.jurisdictionId, dmcc.id),
        isNull(activities.officialCategory)
      )
    );

  results.push({
    category: "Completeness",
    check: "Activities with categories",
    status: missingCategories.value === 0 ? "PASS" : "WARN",
    count: totalCount.value - missingCategories.value,
    details: `${missingCategories.value} activities missing categories`,
  });

  // 2. Uniqueness checks
  const duplicateCodes = await db
    .select({
      code: activities.activityCode,
      count: count(),
    })
    .from(activities)
    .where(eq(activities.jurisdictionId, dmcc.id))
    .groupBy(activities.activityCode)
    .having(sql`count(*) > 1`);

  results.push({
    category: "Uniqueness",
    check: "Duplicate activity codes",
    status: duplicateCodes.length === 0 ? "PASS" : "FAIL",
    count: duplicateCodes.length,
    details: duplicateCodes.length > 0
      ? `Found ${duplicateCodes.length} duplicate codes: ${duplicateCodes.map((d) => d.code).join(", ")}`
      : "No duplicate codes",
  });

  // 3. Verification checks
  const [verifiedCount] = await db
    .select({ value: count() })
    .from(activities)
    .where(
      and(
        eq(activities.jurisdictionId, dmcc.id),
        eq(activities.verificationStatus, "verified")
      )
    );

  results.push({
    category: "Verification",
    check: "Verified activities",
    status: verifiedCount.value === totalCount.value ? "PASS" : "WARN",
    count: verifiedCount.value,
    details: `${verifiedCount.value}/${totalCount.value} verified`,
  });

  const [withLastVerified] = await db
    .select({ value: count() })
    .from(activities)
    .where(
      and(
        eq(activities.jurisdictionId, dmcc.id),
        isNotNull(activities.lastVerified)
      )
    );

  results.push({
    category: "Verification",
    check: "Activities with last_verified date",
    status: withLastVerified.value === totalCount.value ? "PASS" : "WARN",
    count: withLastVerified.value,
    details: `${withLastVerified.value}/${totalCount.value} have last_verified`,
  });

  // 4. Source checks
  const [sourceCount] = await db
    .select({ value: count() })
    .from(sources);

  results.push({
    category: "Source",
    check: "Source records",
    status: sourceCount.value > 0 ? "PASS" : "FAIL",
    count: sourceCount.value,
    details: `${sourceCount.value} source records`,
  });

  // 5. Synonym checks
  const [synonymCount] = await db
    .select({ value: count() })
    .from(activitySynonyms);

  results.push({
    category: "Search",
    check: "Synonyms/index entries",
    status: synonymCount.value > 0 ? "PASS" : "WARN",
    count: synonymCount.value,
    details: `${synonymCount.value} synonym entries for search`,
  });

  // 6. Category distribution
  const categories = await db
    .select({
      category: activities.officialCategory,
      count: count(),
    })
    .from(activities)
    .where(eq(activities.jurisdictionId, dmcc.id))
    .groupBy(activities.officialCategory)
    .orderBy(sql`count(*) DESC`);

  results.push({
    category: "Distribution",
    check: "Category distribution",
    status: "PASS",
    count: categories.length,
    details: categories
      .map((c) => `${c.category}: ${c.count}`)
      .join(", "),
  });

  // 7. Licence type distribution
  const licenceDistribution = await db
    .select({
      licenceId: activities.licenceTypeId,
      count: count(),
    })
    .from(activities)
    .where(eq(activities.jurisdictionId, dmcc.id))
    .groupBy(activities.licenceTypeId);

  const licenceNames = await db
    .select()
    .from(licenceTypes)
    .where(eq(licenceTypes.jurisdictionId, dmcc.id));

  const licenceNameMap = new Map(licenceNames.map((l) => [l.id, l.name]));

  results.push({
    category: "Distribution",
    check: "Licence type distribution",
    status: "PASS",
    count: licenceDistribution.length,
    details: licenceDistribution
      .map(
        (l) =>
          `${licenceNameMap.get(l.licenceId || "") || "Unmapped"}: ${l.count}`
      )
      .join(", "),
  });

  // 8. AI data check - ensure no AI-generated data marked as official
  const [aiMarked] = await db
    .select({ value: count() })
    .from(activities)
    .where(
      and(
        eq(activities.jurisdictionId, dmcc.id),
        sql`${activities.officialName} LIKE '%AI generated%' OR ${activities.officialName} LIKE '%AI suggested%'`
      )
    );

  results.push({
    category: "AI Data",
    check: "No AI-generated data marked official",
    status: aiMarked.value === 0 ? "PASS" : "FAIL",
    count: aiMarked.value,
    details: aiMarked.value === 0
      ? "No AI-generated activity names found"
      : `Found ${aiMarked.value} AI-generated entries`,
  });

  return results;
}

async function main() {
  console.log("=== DMCC Data Quality Audit ===\n");

  const results = await runAudit();

  // Print results
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const result of results) {
    const icon =
      result.status === "PASS" ? "✅" : result.status === "WARN" ? "⚠️" : "❌";
    console.log(
      `${icon} [${result.category}] ${result.check}: ${result.count}`
    );
    console.log(`   ${result.details}`);

    if (result.status === "PASS") passCount++;
    else if (result.status === "WARN") warnCount++;
    else failCount++;
  }

  console.log("\n=== Summary ===");
  console.log(`PASS: ${passCount}`);
  console.log(`WARN: ${warnCount}`);
  console.log(`FAIL: ${failCount}`);

  if (failCount > 0) {
    console.log("\n⚠️  Some checks failed. Review the issues above.");
  } else if (warnCount > 0) {
    console.log("\n✅ All critical checks passed. Some warnings to review.");
  } else {
    console.log("\n✅ All checks passed!");
  }

  await client.end();
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
