/**
 * Search Test Suite v3.3 — 35 tests with quality metrics
 *
 * Quality targets:
 *   Top-1 relevance >= 90%
 *   Top-3 relevance >= 85%
 *   False-positive rate <= 5%
 *   Empty-result accuracy = 100%
 *   Generic-query accuracy >= 80%
 */

import "dotenv/config";
import { search } from "../lib/search/engine";

interface TestCase {
  query: string;
  category: string;
  expected: {
    shouldFind: boolean;
    topMustBeRelevant: boolean;
    maxResults?: number;
    mustNotContain?: string[];
    mustContainAny?: string[];
    minRelevantInTop3?: number;
  };
}

const TEST_CASES: TestCase[] = [
  // === A. EXACT MATCH (5) ===
  {
    query: "diamond trading",
    category: "exact",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 15, mustContainAny: ["Diamond", "Jewellery", "Precious", "Gems"] },
  },
  {
    query: "accounting and bookkeeping",
    category: "exact",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 5, mustContainAny: ["Accounting", "Bookkeeping"] },
  },
  {
    query: "restaurant",
    category: "exact",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 5, mustContainAny: ["Restaurant"] },
  },
  {
    query: "general trading",
    category: "exact",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 5, mustContainAny: ["General Trading"] },
  },
  {
    query: "advertising agency",
    category: "exact",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 8, mustContainAny: ["Advertising"] },
  },

  // === B. STRONG CONCEPT (5) ===
  {
    query: "digital marketing agency",
    category: "strong_concept",
    expected: {
      shouldFind: true, topMustBeRelevant: true, maxResults: 10,
      mustNotContain: ["Travel Agency", "Insurance Agency", "Shipping Agency"],
      mustContainAny: ["Marketing", "Advertising", "Digital", "Public Relations"],
    },
  },
  {
    query: "marketing company",
    category: "strong_concept",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 10, mustContainAny: ["Marketing", "Advertising"] },
  },
  {
    query: "online store selling clothes",
    category: "strong_concept",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 10, mustContainAny: ["Garment", "Clothing", "Apparel", "Fashion", "Textile", "Online"] },
  },
  {
    query: "real estate brokerage",
    category: "strong_concept",
    expected: {
      shouldFind: true, topMustBeRelevant: true, maxResults: 8,
      mustContainAny: ["Brokerage", "Broker", "Real Estate"],
      mustNotContain: ["Mortgage Consultancy", "Real Estate Development", "Real Estate Leasing"],
    },
  },
  {
    query: "software development company",
    category: "strong_concept",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 8, mustContainAny: ["Software", "Programming", "Computer"] },
  },

  // === C. BUSINESS INTENT (5) ===
  {
    query: "medical clinic",
    category: "business_intent",
    expected: {
      shouldFind: true, topMustBeRelevant: true, maxResults: 30,
      mustNotContain: ["Medical Gas Trading", "Medical Equipment", "Medical, Surgical", "Medical Billing"],
      mustContainAny: ["Clinic", "Medical Centre", "Hospital"],
    },
  },
  {
    query: "engineering consultancy",
    category: "business_intent",
    expected: {
      shouldFind: true, topMustBeRelevant: true, maxResults: 10,
      mustContainAny: ["Engineering"],
    },
  },
  {
    query: "logistics and shipping",
    category: "business_intent",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 15, mustContainAny: ["Logistics", "Shipping", "Freight", "Cargo", "Transport"] },
  },
  {
    query: "jewellery gold trading",
    category: "business_intent",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 10, mustContainAny: ["Jewellery", "Gold", "Diamond", "Precious", "Gems"] },
  },
  {
    query: "web development agency",
    category: "business_intent",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 10, mustContainAny: ["Web", "Internet", "Software", "Computer", "Digital"] },
  },

  // === D. TRICKY QUERIES (5) ===
  {
    query: "food business",
    category: "tricky",
    expected: {
      shouldFind: true, topMustBeRelevant: true, maxResults: 15,
      mustNotContain: ["Aviation Consultancy", "Maritime Services", "Travel Agency"],
      mustContainAny: ["Food", "Foodstuff", "Beverage", "Dairy"],
    },
  },
  {
    query: "gym fitness center",
    category: "tricky",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 10, mustContainAny: ["Gym", "Fitness", "Gymnastics"] },
  },
  {
    query: "education training academy",
    category: "tricky",
    expected: {
      shouldFind: true, topMustBeRelevant: true, maxResults: 15,
      mustNotContain: ["Badminton Training", "Basketball Training", "Ping Pong Training"],
      mustContainAny: ["Training", "Education", "Academy", "Learning"],
    },
  },
  {
    query: "petrol station",
    category: "tricky",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 3, mustContainAny: ["Petrol", "Fuel"] },
  },
  {
    query: "dental clinic",
    category: "tricky",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 5, mustContainAny: ["Dental", "Clinic"] },
  },

  // === E. NO MATCH (2) ===
  {
    query: "space tourism",
    category: "no_match",
    expected: { shouldFind: false, topMustBeRelevant: false, maxResults: 0 },
  },
  {
    query: "nuclear power plant",
    category: "no_match",
    expected: { shouldFind: false, topMustBeRelevant: false, maxResults: 0 },
  },

  // === F. BROAD/GENERIC (4) ===
  {
    query: "consulting",
    category: "generic",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 15, mustContainAny: ["Consultancy", "Consulting", "Consultant"] },
  },
  {
    query: "trading",
    category: "generic",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 25 },
  },
  {
    query: "technology",
    category: "generic",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 15, mustContainAny: ["Technology", "IT", "Computer", "Software", "Digital"] },
  },
  {
    query: "bank",
    category: "generic",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 15, mustContainAny: ["Bank", "Banking"] },
  },

  // === G. ADDITIONAL REALISTIC (9) ===
  {
    query: "online electronics store",
    category: "additional",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 10, mustContainAny: ["Electronic", "Technology", "Trading", "Phone", "Computer"] },
  },
  {
    query: "accounting firm",
    category: "additional",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 8, mustContainAny: ["Accounting", "Bookkeeping", "Audit"] },
  },
  {
    query: "fashion brand",
    category: "additional",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 10, mustContainAny: ["Garment", "Fashion", "Clothing", "Apparel", "Textile"] },
  },
  {
    query: "cryptocurrency exchange",
    category: "additional",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 10, mustContainAny: ["Virtual Assets", "Crypto", "Blockchain", "Digital"] },
  },
  {
    query: "interior design company",
    category: "additional",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 8, mustContainAny: ["Interior", "Design"] },
  },
  {
    query: "event management company",
    category: "additional",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 10, mustContainAny: ["Events", "Event", "Management", "Organizing"] },
  },
  {
    query: "security company",
    category: "additional",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 10, mustContainAny: ["Security", "Safety"] },
  },
  {
    query: "translation services",
    category: "additional",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 8, mustContainAny: ["Translation", "Interpreter", "Interpretation"] },
  },
  {
    query: "wedding planning",
    category: "additional",
    expected: { shouldFind: true, topMustBeRelevant: true, maxResults: 10, mustContainAny: ["Wedding", "Event", "Events", "Planning"] },
  },
];

interface TestResult {
  testNumber: number;
  query: string;
  category: string;
  resultCount: number;
  topResult: string | null;
  topResultType: string;
  topResultScore: number;
  top1Relevant: boolean;
  top3Relevant: boolean;
  falsePositive: boolean;
  passed: boolean;
  reason: string;
}

async function runTests() {
  console.log("=== SEARCH QUALITY TEST SUITE v3.3 ===\n");

  const results: TestResult[] = [];
  let totalTests = 0;

  for (const tc of TEST_CASES) {
    totalTests++;
    const searchResults = await search({ q: tc.query, limit: 25 });

    // Determine if top result is relevant
    const topResult = searchResults.length > 0 ? searchResults[0] : null;
    const top1Relevant = topResult ? topResult.matchScore >= 0.60 : false;

    // Determine if top 3 have relevant results
    const top3 = searchResults.slice(0, 3);
    const top3RelevantCount = top3.filter(r => r.matchScore >= 0.60).length;
    const top3Relevant = tc.expected.minRelevantInTop3
      ? top3RelevantCount >= tc.expected.minRelevantInTop3
      : top3RelevantCount >= 1;

    // Check for false positives
    let falsePositive = false;
    if (tc.expected.mustNotContain && searchResults.length > 0) {
      const violations = searchResults.filter(r =>
        tc.expected.mustNotContain!.some(bad => r.activity.officialName.includes(bad))
      );
      if (violations.length > 0) falsePositive = true;
    }

    // Check mustContainAny
    let hasRequiredContent = true;
    if (tc.expected.mustContainAny && searchResults.length > 0) {
      hasRequiredContent = searchResults.some(r =>
        tc.expected.mustContainAny!.some(term => r.activity.officialName.toLowerCase().includes(term.toLowerCase()))
      );
    }

    // Determine pass/fail
    let passed = true;
    let reason = "PASS";

    if (tc.expected.shouldFind && searchResults.length === 0) {
      passed = false;
      reason = "FAIL: Expected results but found none";
    } else if (!tc.expected.shouldFind && searchResults.length > 0) {
      passed = false;
      reason = `FAIL: Expected no results but found ${searchResults.length}`;
    } else if (tc.expected.maxResults && searchResults.length > tc.expected.maxResults) {
      passed = false;
      reason = `FAIL: Expected max ${tc.expected.maxResults} but found ${searchResults.length}`;
    } else if (tc.expected.topMustBeRelevant && !top1Relevant && searchResults.length > 0) {
      passed = false;
      reason = `FAIL: Top result "${topResult?.activity.officialName}" not relevant (score: ${topResult?.matchScore})`;
    } else if (falsePositive) {
      passed = false;
      reason = "FAIL: Contains forbidden result (false positive)";
    } else if (!hasRequiredContent && searchResults.length > 0) {
      passed = false;
      reason = `FAIL: Missing required content (${tc.expected.mustContainAny?.join(", ")})`;
    }

    const tr: TestResult = {
      testNumber: totalTests,
      query: tc.query,
      category: tc.category,
      resultCount: searchResults.length,
      topResult: topResult?.activity.officialName ?? null,
      topResultType: topResult?.matchType ?? "none",
      topResultScore: topResult?.matchScore ?? 0,
      top1Relevant,
      top3Relevant,
      falsePositive,
      passed,
      reason,
    };
    results.push(tr);

    // Print result
    const status = passed ? "PASS" : "FAIL";
    console.log(`--- Test ${totalTests}: "${tc.query}" [${tc.category}] ---`);
    console.log(`  ${status}: ${reason}`);
    console.log(`  Results: ${searchResults.length} | Top: ${tr.topResult} (${tr.topResultType}, ${tr.topResultScore.toFixed(2)})`);
    if (searchResults.length > 0 && searchResults.length <= 8) {
      searchResults.forEach(r => {
        console.log(`    ${r.matchType.padEnd(12)} ${r.matchScore.toFixed(2)}  ${r.activity.officialName}`);
      });
    }
    console.log();
  }

  // Calculate metrics
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  const top1RelevantCount = results.filter(r => r.top1Relevant || !r.passed && r.resultCount === 0).length;
  const emptyResultTests = results.filter(r => !TEST_CASES[r.testNumber - 1].expected.shouldFind);
  const emptyResultCorrect = emptyResultTests.filter(r => r.resultCount === 0).length;

  const noMatchTests = results.filter(r => r.category === "no_match");
  const noMatchCorrect = noMatchTests.filter(r => r.resultCount === 0).length;

  const genericTests = results.filter(r => r.category === "generic");
  const genericPassed = genericTests.filter(r => r.passed).length;

  const falsePositives = results.filter(r => r.falsePositive).length;

  // Top-1 relevance: tests where shouldFind=true AND top result is relevant
  const shouldFindTests = results.filter(r => TEST_CASES[r.testNumber - 1].expected.shouldFind);
  const top1Relevance = shouldFindTests.length > 0
    ? (shouldFindTests.filter(r => r.top1Relevant).length / shouldFindTests.length * 100)
    : 0;

  // Top-3 relevance: tests where shouldFind=true AND top 3 has relevant
  const top3Relevance = shouldFindTests.length > 0
    ? (shouldFindTests.filter(r => r.top3Relevant).length / shouldFindTests.length * 100)
    : 0;

  const fpRate = total > 0 ? (falsePositives / total * 100) : 0;
  const emptyAccuracy = noMatchTests.length > 0 ? (noMatchCorrect / noMatchTests.length * 100) : 100;
  const genericAccuracy = genericTests.length > 0 ? (genericPassed / genericTests.length * 100) : 100;

  console.log("==================================================");
  console.log("SEARCH QUALITY REPORT v3.3");
  console.log("==================================================\n");

  console.log(`Total Tests:       ${total}`);
  console.log(`Passed:            ${passed}`);
  console.log(`Failed:            ${failed}`);
  console.log(`Pass Rate:         ${(passed / total * 100).toFixed(1)}%\n`);

  console.log("QUALITY METRICS:");
  console.log(`  Top-1 Relevance:         ${top1Relevance.toFixed(1)}% (target >= 90%) ${top1Relevance >= 90 ? "PASS" : "FAIL"}`);
  console.log(`  Top-3 Relevance:         ${top3Relevance.toFixed(1)}% (target >= 85%) ${top3Relevance >= 85 ? "PASS" : "FAIL"}`);
  console.log(`  False-Positive Rate:     ${fpRate.toFixed(1)}% (target <= 5%) ${fpRate <= 5 ? "PASS" : "FAIL"}`);
  console.log(`  Empty-Result Accuracy:   ${emptyAccuracy.toFixed(1)}% (target = 100%) ${emptyAccuracy === 100 ? "PASS" : "FAIL"}`);
  console.log(`  Generic-Query Accuracy:  ${genericAccuracy.toFixed(1)}% (target >= 80%) ${genericAccuracy >= 80 ? "PASS" : "FAIL"}\n`);

  console.log("FAILED TESTS:");
  const failedTests = results.filter(r => !r.passed);
  if (failedTests.length === 0) {
    console.log("  None");
  } else {
    failedTests.forEach(r => {
      console.log(`  Test ${r.testNumber}: "${r.query}" — ${r.reason}`);
      if (r.topResult) console.log(`    Top: ${r.topResult} (${r.topResultType}, ${r.topResultScore.toFixed(2)})`);
    });
  }

  console.log("\n==================================================");
  console.log("END OF REPORT");
  console.log("==================================================");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
