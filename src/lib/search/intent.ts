import type { SearchQuery } from "@/types";

/**
 * AI intent detection for UAE business queries.
 *
 * This module interprets natural-language business ideas and extracts:
 * - Business type
 * - Industry
 * - Business model
 * - Potential activity categories
 *
 * This does NOT generate official activity names.
 * It only provides search hints for the verified database.
 */

// ===== BUSINESS INTENT PATTERNS =====

const INTENT_PATTERNS: Record<string, string[]> = {
  marketing: [
    "marketing",
    "advertising",
    "social media",
    "instagram",
    "facebook",
    "digital marketing",
    "brand",
    "promotion",
    "pr",
    "public relations",
  ],
  trading: [
    "trading",
    "import",
    "export",
    "wholesale",
    "retail",
    "buy",
    "sell",
    "distribute",
    "supply",
  ],
  technology: [
    "software",
    "technology",
    "ai",
    "app",
    "saas",
    "tech",
    "it",
    "digital",
    "platform",
    "development",
  ],
  consulting: [
    "consultancy",
    "consulting",
    "advisory",
    "advisor",
    "professional services",
    "management",
  ],
  food: [
    "restaurant",
    "cafe",
    "food",
    "catering",
    "bakery",
    "cloud kitchen",
    "delivery",
  ],
  healthcare: [
    "medical",
    "clinic",
    "health",
    "pharmacy",
    "dental",
    "hospital",
    "wellness",
  ],
  finance: [
    "accounting",
    "audit",
    "finance",
    "bookkeeping",
    "tax",
    "financial",
  ],
  education: [
    "education",
    "training",
    "academy",
    "school",
    "tutoring",
    "learning",
  ],
  construction: [
    "construction",
    "building",
    "contracting",
    "fit-out",
    "maintenance",
    "engineering",
  ],
  crypto: [
    "crypto",
    "blockchain",
    "web3",
    "defi",
    "token",
    "nft",
    "virtual assets",
  ],
  ecommerce: [
    "ecommerce",
    "e-commerce",
    "online store",
    "amazon",
    "noon",
    "online selling",
    "dropshipping",
  ],
};

// ===== INTENT DETECTION =====

export interface DetectedIntent {
  category: string;
  confidence: number;
  keywords: string[];
}

export function detectIntent(query: string): DetectedIntent[] {
  const lower = query.toLowerCase();
  const intents: DetectedIntent[] = [];

  for (const [category, patterns] of Object.entries(INTENT_PATTERNS)) {
    const matchedPatterns = patterns.filter((p) => lower.includes(p));
    if (matchedPatterns.length > 0) {
      intents.push({
        category,
        confidence: Math.min(matchedPatterns.length / 3, 1.0),
        keywords: matchedPatterns,
      });
    }
  }

  return intents.sort((a, b) => b.confidence - a.confidence);
}

// ===== SEARCH TERM GENERATION =====

export function generateSearchTerms(query: string): string[] {
  const intents = detectIntent(query);
  const terms: string[] = [];

  for (const intent of intents) {
    terms.push(...intent.keywords);
  }

  // Add the original query keywords
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  terms.push(...words);

  // Deduplicate
  return [...new Set(terms)];
}
