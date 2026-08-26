/**
 * Production Search Engine v4
 *
 * Two-track keywords, deterministic intent detection,
 * generic-word weighting, 7-level scoring hierarchy.
 *
 * v4 changes:
 * - No debug logging in hot paths.
 * - Deterministic candidate retrieval (every tier has ORDER BY; no arbitrary truncation).
 * - Additional retrieval tiers: category/group and description.
 * - Results expose approvalSignal, source (url/title/lastVerified) and licence binding.
 * - searchUnified() returns flat results plus per-jurisdiction grouping and
 *   availability so every indexed jurisdiction reports MATCH / NO MATCH explicitly.
 * - Performance metadata (tookMs, candidates evaluated) returned with each search.
 */

import { db } from "@/lib/db";
import {
  activities,
  jurisdictions,
  licenceTypes,
  sources,
  activitySources,
} from "@/lib/db/schema";
import { eq, or, ilike, sql } from "drizzle-orm";
import type {
  MatchType,
  BusinessIntent,
  SearchResultItem,
  JurisdictionGroup,
  SearchAvailability,
  UnifiedSearchResponse,
  SearchOptions,
} from "./types";

export type { SearchOptions, MatchType } from "./types";

// ============================================================
// SECTION 1: WORD WEIGHTS
// ============================================================

const WORD_WEIGHTS: Record<string, number> = {
  company: 0.05, business: 0.05, services: 0.05, service: 0.05,
  agency: 0.10, firm: 0.10, consultancy: 0.10, consulting: 0.10,
  consultant: 0.10, consultants: 0.10, trading: 0.15, management: 0.10,
  solutions: 0.05, center: 0.05, centre: 0.05,
  enterprise: 0.05, enterprises: 0.05, group: 0.05,
  international: 0.05, general: 0.05, specialized: 0.05,
  providers: 0.05, provider: 0.05, supplies: 0.05,

  marketing: 0.40, advertising: 0.40, design: 0.35,
  education: 0.40, training: 0.35, academy: 0.40,
  logistics: 0.40, shipping: 0.40, transport: 0.35, transportation: 0.35,
  food: 0.40, beverage: 0.40, dairy: 0.40,
  construction: 0.35, engineering: 0.40,
  security: 0.35, safety: 0.35,
  property: 0.40, estate: 0.35, realty: 0.40,
  web: 0.35, internet: 0.35, digital: 0.35, online: 0.30,
  computer: 0.40, data: 0.30, network: 0.30,
  investment: 0.30, financial: 0.30, finance: 0.30,
  energy: 0.35, renewable: 0.40, solar: 0.45,
  automotive: 0.35, motor: 0.30, vehicle: 0.35,
  agriculture: 0.40, agricultural: 0.40, farming: 0.40,
  mining: 0.35, metals: 0.30, minerals: 0.30,
  chemicals: 0.30, pharmaceutical: 0.45,
  textile: 0.35, apparel: 0.40, garment: 0.45, clothing: 0.45, fashion: 0.40,
  perfume: 0.40, cosmetics: 0.40, beauty: 0.35,
  furniture: 0.35, wood: 0.30, marble: 0.35,
  print: 0.30, printing: 0.30, packaging: 0.30,
  media: 0.35, entertainment: 0.30, recreation: 0.30,
  travel: 0.35, tourism: 0.35, hospitality: 0.30, hotel: 0.40,
  cleaning: 0.30, pest: 0.35,
  laundry: 0.35, tailoring: 0.40,
  salon: 0.40, spa: 0.30, gym: 0.45, fitness: 0.40,
  wedding: 0.45, event: 0.30, events: 0.30,
  photography: 0.35, video: 0.30, audio: 0.30,
  translation: 0.45, interpretation: 0.45,
  recruitment: 0.40, employment: 0.35, staffing: 0.35,
  insurance: 0.35, legal: 0.35, accounting: 0.45, bookkeeping: 0.45, audit: 0.40,
  architect: 0.40, interior: 0.35, landscape: 0.35,

  medical: 0.80, clinic: 0.85, clinics: 0.85, dental: 0.85,
  surgery: 0.75, surgical: 0.70, hospital: 0.85,
  software: 0.90, programming: 0.85, development: 0.55,
  brokerage: 0.85, broker: 0.80, brokers: 0.80,
  diamond: 0.90, jewellery: 0.90, jewelry: 0.90, gold: 0.70, precious: 0.80, gems: 0.80,
  restaurant: 0.90, cafe: 0.85, bakery: 0.85, catering: 0.60,
  bank: 0.85, banking: 0.85,
  crypto: 0.85, blockchain: 0.85, web3: 0.85,
  aviation: 0.80, maritime: 0.75, petroleum: 0.70, oil: 0.55, gas: 0.40,
  pharmacy: 0.85, pharmacies: 0.85, drug: 0.60,
  petrol: 0.80, fuel: 0.55,
  supermarket: 0.80, retail: 0.45, wholesale: 0.40,
  warehouse: 0.50, warehousing: 0.50, storage: 0.35,
  freight: 0.50, cargo: 0.50,
  pastry: 0.70,
  tea: 0.50, coffee: 0.50, spice: 0.50, spices: 0.50,
  honey: 0.55, meat: 0.50, fish: 0.45, seafood: 0.50,
  fruit: 0.45, vegetable: 0.45, grain: 0.45,
  rice: 0.50, wheat: 0.45, sugar: 0.45,
  steel: 0.40, iron: 0.40, cement: 0.40, pipe: 0.35,
  tile: 0.35, brick: 0.35, glass: 0.35,
  paper: 0.35, plastic: 0.30, rubber: 0.30,
  mobile: 0.40, phone: 0.35, satellite: 0.50,
  electronics: 0.55, electronic: 0.50, electrical: 0.45, gadget: 0.45, gadgets: 0.45,
  robot: 0.50, drone: 0.50,
  horse: 0.45, animal: 0.40, bird: 0.40, pet: 0.40,
  florist: 0.50, flowers: 0.45, nursery: 0.40,
  gymnastics: 0.55, swimming: 0.45, tennis: 0.45,
  football: 0.45, basketball: 0.45, cricket: 0.45,
  chess: 0.45, gaming: 0.40, esports: 0.45,
  cinema: 0.40, theater: 0.40, theatre: 0.40,
  museum: 0.40, gallery: 0.35,
  charity: 0.35, social: 0.30,
  veterinary: 0.60, vet: 0.50,
};

function getWordWeight(word: string): number {
  const lower = word.toLowerCase();
  if (WORD_WEIGHTS[lower] !== undefined) return WORD_WEIGHTS[lower];
  return 0.20;
}

function isGenericWord(word: string): boolean {
  return [
    "company", "business", "services", "service", "agency", "firm",
    "consultancy", "consulting", "consultant", "consultants", "trading",
    "management", "solutions", "center", "centre", "enterprise", "enterprises",
    "group", "international", "general", "specialized", "providers", "provider",
  ].includes(word.toLowerCase());
}

// ============================================================
// SECTION 2: WORD VARIATIONS (STEMMING)
// ============================================================

const WORD_VARIATIONS: Record<string, string[]> = {
  consulting: ["consultancy", "consultancies", "consultant", "consultants", "consulting"],
  consultancy: ["consultancy", "consultancies", "consultant", "consultants", "consulting"],
  marketing: ["marketing", "market", "marketed"],
  trading: ["trading", "trade", "trader", "traders"],
  advertising: ["advertising", "advertisement", "advert", "advertisements"],
  clothing: ["garment", "garments", "apparel", "textile", "textiles", "clothing", "fashion"],
  food: ["food", "foodstuff", "foodstuffs", "beverage", "beverages", "dairy"],
  technology: ["technology", "technologies", "tech"],
  software: ["software", "programming", "development"],
  education: ["education", "educational", "training", "academy", "learning"],
  training: ["training", "education", "academy", "learn", "learning"],
  logistics: ["logistics", "shipping", "freight", "cargo", "transport", "warehousing"],
  fitness: ["fitness", "gym", "gymnastics", "health", "wellness", "sports"],
  jewellery: ["jewellery", "jewelry", "jewels", "gems", "diamond", "gold", "precious"],
  medical: ["medical", "healthcare", "health", "clinic", "clinical", "hospital"],
  clinic: ["clinic", "clinics", "clinical", "medical"],
  realestate: ["real estate", "property", "properties", "realty"],
  crypto: ["crypto", "cryptocurrency", "blockchain", "virtual assets", "digital assets", "web3"],
  engineering: ["engineering", "engineer", "engineers"],
  development: ["development", "developing", "developer", "developers"],
  programming: ["programming", "programmer", "programmers", "software"],
  brokerage: ["brokerage", "broker", "brokers", "broking"],
  security: ["security", "safety", "protection", "guard"],
  accounting: ["accounting", "bookkeeping", "accountancy", "accountant"],
  design: ["design", "designing", "designer", "designers"],
  photography: ["photography", "photographer", "photographers"],
  translation: ["translation", "translator", "translators", "interpretation", "interpreter"],
  recruitment: ["recruitment", "recruiting", "recruiter", "staffing", "employment"],
  web: ["web", "internet", "online", "digital"],
  electronics: ["electronics", "electronic", "electrical", "computer", "devices"],
  interior: ["interior", "interior design", "decoration"],
  event: ["event", "events", "management"],
};

// ============================================================
// SECTION 3: STOP WORDS
// ============================================================

const STOP_WORDS = new Set([
  "i", "want", "to", "start", "a", "an", "the", "my", "our",
  "in", "from", "and", "or", "with", "for",
  "of", "is", "are", "be", "do", "can", "will", "would", "should",
  "could", "need", "like", "looking", "open", "set", "up", "run",
  "buying",
]);

// ============================================================
// SECTION 4: BUSINESS INTENT DETECTION
// ============================================================

interface IntentPattern {
  pattern: RegExp;
  intent: Omit<BusinessIntent, "isGenericQuery" | "specificityLevel">;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    pattern: /^space\s+tourism$/i,
    intent: {
      primaryNoun: "tourism",
      qualifiers: ["space"],
      industryDomain: "impossible",
      requiredTerms: ["space tourism"],
      excludedTerms: ["space", "tourism", "travel", "consultancy"],
    },
  },
  {
    pattern: /^nuclear\s+power/i,
    intent: {
      primaryNoun: "nuclear",
      qualifiers: ["power", "plant"],
      industryDomain: "impossible",
      requiredTerms: ["nuclear"],
      excludedTerms: ["nuclear", "power", "plant"],
    },
  },
  {
    pattern: /^medical\s+clinic$/i,
    intent: {
      primaryNoun: "clinic",
      qualifiers: ["medical", "healthcare", "health"],
      industryDomain: "healthcare",
      requiredTerms: ["clinic"],
      excludedTerms: ["gas", "equipment", "devices", "supplies", "billing", "insurance", "articles", "requisites"],
    },
  },
  {
    pattern: /^dental\s+clinic$/i,
    intent: {
      primaryNoun: "dental",
      qualifiers: ["clinic"],
      industryDomain: "healthcare",
      requiredTerms: ["dental", "clinic"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^real\s+estate\s+brokerage$/i,
    intent: {
      primaryNoun: "brokerage",
      qualifiers: ["real estate", "property", "estate"],
      industryDomain: "real estate",
      requiredTerms: ["brokerage", "broker", "broking"],
      excludedTerms: ["mortgage", "consultancy", "development", "leasing", "promotion", "survey", "valuation", "supervision", "representative"],
    },
  },
  {
    pattern: /^software\s+development/i,
    intent: {
      primaryNoun: "software",
      qualifiers: ["development", "programming", "design", "computer"],
      industryDomain: "technology",
      requiredTerms: ["software"],
      excludedTerms: ["trading", "education", "training"],
    },
  },
  {
    pattern: /^software\s+company|^software\s+business|^software\s+house/i,
    intent: {
      primaryNoun: "software",
      qualifiers: ["development", "programming", "design", "computer", "systems"],
      industryDomain: "technology",
      requiredTerms: ["software"],
      excludedTerms: ["trading", "education", "training"],
    },
  },
  {
    pattern: /^clothing|^garment|^apparel|^fashion/i,
    intent: {
      primaryNoun: "garment",
      qualifiers: ["clothing", "apparel", "fashion", "textile"],
      industryDomain: "retail",
      requiredTerms: ["garment", "garments", "clothing", "apparel", "fashion", "textile", "textiles"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^engineering\s+consultancy/i,
    intent: {
      primaryNoun: "engineering",
      qualifiers: ["consultancy", "consulting"],
      industryDomain: "engineering",
      requiredTerms: ["engineering"],
      excludedTerms: ["aviation", "marine", "renewable", "fire safety", "noise", "vibration", "acoustics"],
    },
  },
  {
    pattern: /^digital\s+marketing/i,
    intent: {
      primaryNoun: "marketing",
      qualifiers: ["digital", "online", "advertising"],
      industryDomain: "media",
      requiredTerms: ["marketing"],
      excludedTerms: ["travel", "insurance", "shipping"],
    },
  },
  {
    pattern: /online.*store.*sell.*cloth|online.*sell.*cloth/i,
    intent: {
      primaryNoun: "garment",
      qualifiers: ["clothing", "apparel", "fashion", "textile", "online"],
      industryDomain: "retail",
      requiredTerms: ["garment", "garments", "clothing", "apparel", "fashion", "textile"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^online\s+electronics|^electronics\s+(store|shop|trading|retail)/i,
    intent: {
      primaryNoun: "electronics",
      qualifiers: ["online", "electronic", "electrical", "computer", "retail"],
      industryDomain: "consumer electronics",
      requiredTerms: ["electronics", "electronic"],
      excludedTerms: ["waste", "scrap"],
    },
  },
  {
    pattern: /^online\s+(electronics|store|retail|shop|shopping)|^ecommerce|^e-commerce|^online\s+business/i,
    intent: {
      primaryNoun: "retail",
      qualifiers: ["online", "ecommerce", "internet", "digital", "marketplace"],
      industryDomain: "retail",
      requiredTerms: ["trading", "retail", "marketplace"],
      excludedTerms: ["gaming", "sports"],
    },
  },
  {
    pattern: /jewellery.*trading|jewelry.*trading|gold.*trading/i,
    intent: {
      primaryNoun: "jewellery",
      qualifiers: ["gold", "diamond", "precious", "gems", "trading"],
      industryDomain: "precious metals",
      requiredTerms: ["jewellery", "jewelry", "gold", "precious"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^food\s+business|^food\s+trading|^food\s+company/i,
    intent: {
      primaryNoun: "food",
      qualifiers: ["trading", "business"],
      industryDomain: "food",
      requiredTerms: ["food", "foodstuff", "beverage"],
      excludedTerms: ["aviation", "maritime", "travel"],
    },
  },
  {
    pattern: /^gym|^fitness/i,
    intent: {
      primaryNoun: "gym",
      qualifiers: ["fitness", "health", "sports"],
      industryDomain: "fitness",
      requiredTerms: ["gym", "fitness", "gymnastics"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^education\s+training\s+academy/i,
    intent: {
      primaryNoun: "training",
      qualifiers: ["education", "academy", "learning"],
      industryDomain: "education",
      requiredTerms: ["training", "education", "academy"],
      excludedTerms: ["badminton", "basketball", "ping pong", "squash", "tennis", "volleyball", "wrestling", "swimming", "ice skating", "football", "cricket", "chess", "gaming", "sports"],
    },
  },
  {
    pattern: /^web\s+development/i,
    intent: {
      primaryNoun: "web",
      qualifiers: ["development", "design", "internet"],
      industryDomain: "technology",
      requiredTerms: ["web", "internet"],
      excludedTerms: ["trading"],
    },
  },
  {
    pattern: /^accounting\s+(and\s+)?bookkeeping/i,
    intent: {
      primaryNoun: "accounting",
      qualifiers: ["bookkeeping"],
      industryDomain: "professional services",
      requiredTerms: ["accounting", "bookkeeping"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^logistics(\s+(and|\+)\s+(shipping|freight|cargo))?(\s+(company|services))?$/i,
    intent: {
      primaryNoun: "logistics",
      qualifiers: ["shipping", "freight", "cargo", "transport"],
      industryDomain: "logistics",
      requiredTerms: ["logistics", "shipping", "freight", "cargo"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^restaurant|^cafe|^coffee\s+shop/i,
    intent: {
      primaryNoun: "restaurant",
      qualifiers: ["cafe", "food", "beverage", "catering"],
      industryDomain: "food",
      requiredTerms: ["restaurant"],
      excludedTerms: ["equipment", "supplies", "fitout", "consultancy"],
    },
  },
  {
    pattern: /^cryptocurrency|^crypto\s+(exchange|company|trading)/i,
    intent: {
      primaryNoun: "virtual assets",
      qualifiers: ["crypto", "cryptocurrency", "blockchain", "exchange"],
      industryDomain: "crypto",
      requiredTerms: ["virtual assets", "crypto", "cryptocurrency", "blockchain"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^event\s+management/i,
    intent: {
      primaryNoun: "events",
      qualifiers: ["management", "organizing"],
      industryDomain: "events",
      requiredTerms: ["events", "event"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^interior\s+design/i,
    intent: {
      primaryNoun: "interior",
      qualifiers: ["design", "decoration"],
      industryDomain: "design",
      requiredTerms: ["interior"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^wedding\s+planning/i,
    intent: {
      primaryNoun: "event",
      qualifiers: ["wedding", "planning", "management", "organizing"],
      industryDomain: "events",
      requiredTerms: ["event", "events", "wedding"],
      excludedTerms: [],
    },
  },
  {
    pattern: /online\s+store\s+.*\s+(clothes|clothing|apparel|fashion|garment)/i,
    intent: {
      primaryNoun: "garment",
      qualifiers: ["online", "store", "retail", "clothing"],
      industryDomain: "retail",
      requiredTerms: ["garment", "clothing", "apparel", "fashion", "textile"],
      excludedTerms: [],
    },
  },
  {
    pattern: /translation\s+services/i,
    intent: {
      primaryNoun: "translation",
      qualifiers: ["services", "interpretation"],
      industryDomain: "professional services",
      requiredTerms: ["translation", "interpretation"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^security\s+company|^security\s+services/i,
    intent: {
      primaryNoun: "security",
      qualifiers: ["guard", "protection"],
      industryDomain: "security",
      requiredTerms: ["security"],
      excludedTerms: ["cyber"],
    },
  },
  {
    pattern: /^accounting(\s+(firm|company|services|consultancy))?$/i,
    intent: {
      primaryNoun: "accounting",
      qualifiers: ["bookkeeping", "audit", "financial"],
      industryDomain: "professional services",
      requiredTerms: ["accounting", "bookkeeping", "audit"],
      excludedTerms: [],
    },
  },
];

function detectBusinessIntent(query: string): BusinessIntent {
  const q = query.toLowerCase().trim();

  for (const { pattern, intent } of INTENT_PATTERNS) {
    if (pattern.test(q)) {
      const words = extractOriginalWords(q);
      const specificity = words.length >= 3 ? "very_specific" : words.length === 2 ? "specific" : "broad";
      return { ...intent, isGenericQuery: false, specificityLevel: specificity };
    }
  }

  const words = extractOriginalWords(q);
  let primaryNoun: string;
  let qualifiers: string[];
  if (words.length >= 2) {
    const specificWord = words.find(w => !isGenericWord(w)) || words[0];
    primaryNoun = specificWord;
    qualifiers = words.filter(w => w !== specificWord);
  } else {
    primaryNoun = words[0] || q;
    qualifiers = [];
  }

  const isGeneric = words.length === 1 && isGenericWord(primaryNoun);
  const specificity = words.length >= 3 ? "very_specific" : words.length === 2 ? "specific" : "broad";

  return {
    primaryNoun,
    qualifiers,
    industryDomain: "general",
    requiredTerms: [primaryNoun],
    excludedTerms: [],
    isGenericQuery: isGeneric,
    specificityLevel: specificity,
  };
}

// ============================================================
// SECTION 5: KEYWORD EXTRACTION (TWO-TRACK)
// ============================================================

interface ExtractedKeywords {
  originalWords: string[];
  expandedTerms: string[];
}

function extractOriginalWords(query: string): string[] {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .split(" ")
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function extractKeywords(query: string): ExtractedKeywords {
  const originalWords = extractOriginalWords(query);

  const expanded = new Set(originalWords);
  for (const word of originalWords) {
    for (const [, variations] of Object.entries(WORD_VARIATIONS)) {
      if (variations.some(v => v === word || v.includes(word) || word.includes(v))) {
        variations.forEach(v => expanded.add(v));
      }
    }
  }

  return { originalWords, expandedTerms: Array.from(expanded) };
}

// ============================================================
// SECTION 6: NEGATIVE RELEVANCE
// ============================================================

function isExcludedByIntent(
  activityName: string,
  intent: BusinessIntent
): boolean {
  const lower = activityName.toLowerCase();
  if (intent.excludedTerms.length === 0) return false;
  return intent.excludedTerms.some(et => lower.includes(et));
}

function isNegativeMatch(activityName: string, intent: BusinessIntent): boolean {
  if (isExcludedByIntent(activityName, intent)) return true;

  const lower = activityName.toLowerCase();

  // Authorities often scope activities OUT explicitly, e.g.
  // "...but not including real estate brokerage". Such activities are
  // negatives for a query about the excluded concept.
  const scopeOutRe = /\b(?:not\s+including|excluding)\s+([^,;()]{3,80})/g;
  let m: RegExpExecArray | null;
  while ((m = scopeOutRe.exec(lower)) !== null) {
    const segment = m[1];
    const concepts = [intent.primaryNoun, ...intent.requiredTerms].filter(Boolean);
    if (concepts.some(c => c.length > 2 && segment.includes(c))) return true;
  }

  if (intent.primaryNoun === "clinic") {
    if (/medical\s+(gas|equipment|devices|supplies|articles|requisites)\s+trading/i.test(lower)) return true;
    if (/medical\s+billing/i.test(lower)) return true;
    if (/medical\s+insurance/i.test(lower)) return true;
  }
  if (intent.primaryNoun === "marketing") {
    if (/travel\s+agency/i.test(lower)) return true;
  }
  return false;
}

// ============================================================
// SECTION 7: SCORING — 7-LEVEL HIERARCHY
// ============================================================

interface ScoredResult {
  activityId: string;
  matchType: MatchType;
  score: number;
  reasons: string[];
}

interface ScoreInput {
  id: string;
  officialName: string;
  normalizedName: string;
  activityCode: string | null;
  description: string | null;
  officialCategory: string | null;
  activityGroup: string | null;
}

/** Whole-word containment, ignoring occurrences negated by "non-X"/"not X". */
function termAppearsUnnegated(haystack: string, term: string): boolean {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b`, "i");
  if (!re.test(haystack)) return false;
  const negRe = new RegExp(`\\b(?:non[-\\s]?|not[-\\s])${esc}\\b`, "i");
  return !negRe.test(haystack);
}

function scoreActivity(
  intent: BusinessIntent,
  keywords: ExtractedKeywords,
  activity: ScoreInput
): ScoredResult | null {
  const nn = activity.normalizedName;
  const nq = keywords.originalWords.join(" ");

  // 0. NEGATIVE RELEVANCE
  if (isNegativeMatch(activity.officialName, intent)) {
    return null;
  }

  // 0b. IMPOSSIBLE QUERY CHECK — require ALL required terms present verbatim
  if (intent.industryDomain === "impossible") {
    const nnWords = nn.split(/\s+/);
    const allRequiredMatch = intent.requiredTerms.every(rt => {
      const rtLower = rt.toLowerCase();
      if (nnWords.some(w => w === rtLower)) return true;
      if (nn.includes(rtLower)) return true;
      return false;
    });
    if (!allRequiredMatch) return null;
  }

  // LEVEL 1: EXACT NAME MATCH (1.0)
  if (nn === nq) {
    return { activityId: activity.id, matchType: "exact", score: 1.0, reasons: ["Exact official activity name match"] };
  }

  // LEVEL 2: EXACT CODE MATCH (0.98)
  if (activity.activityCode && nq === activity.activityCode.replace(/\s/g, "")) {
    return { activityId: activity.id, matchType: "exact", score: 0.98, reasons: ["Exact activity code match"] };
  }

  // LEVEL 3: HIGH CONFIDENCE PHRASE (0.92)
  // Primary noun in the name + a qualifier (or a term from the qualifier's own
  // variation family) also present. A "Cardiac Clinic" satisfies the medical
  // qualifier because "clinic" belongs to the same concept family.
  const primaryInName = nn.includes(intent.primaryNoun.toLowerCase());
  const qualifierFamilyTerms = new Set<string>();
  for (const q of intent.qualifiers) {
    const ql = q.toLowerCase();
    if (ql.length > 2) qualifierFamilyTerms.add(ql);
    for (const v of WORD_VARIATIONS[ql] ?? []) {
      if (v.length > 2) qualifierFamilyTerms.add(v);
    }
  }
  const qualifierInName =
    intent.qualifiers.some(q => nn.includes(q.toLowerCase())) ||
    [...qualifierFamilyTerms].some(t => nn.includes(t));

  if (primaryInName && qualifierInName) {
    return {
      activityId: activity.id,
      matchType: "strong",
      score: 0.92,
      reasons: [`Business concept match: ${intent.primaryNoun} + qualifier in "${activity.officialName}"`],
    };
  }

  // LEVEL 4: STRONG MULTI-TERM (0.78-0.90)
  const matchedOriginals = keywords.originalWords.filter(w => termAppearsUnnegated(nn, w));
  const matchedWeights = matchedOriginals.map(w => getWordWeight(w));
  const avgWeight = matchedWeights.length > 0 ? matchedWeights.reduce((a, b) => a + b, 0) / matchedWeights.length : 0;

  if (matchedOriginals.length >= 2) {
    const hasStrongWord = matchedWeights.some(w => w >= 0.40);
    const baseScore = hasStrongWord ? 0.85 : 0.78;
    const countBonus = Math.min((matchedOriginals.length - 2) * 0.02, 0.05);
    const weightBonus = Math.min(avgWeight * 0.15, 0.05);
    const score = Math.min(baseScore + countBonus + weightBonus, 0.90);

    if (score >= 0.80) {
      return {
        activityId: activity.id,
        matchType: "strong",
        score: Math.round(score * 100) / 100,
        reasons: [`Multi-term match: ${matchedOriginals.join(", ")} in "${activity.officialName}"`],
      };
    }
  }

  // LEVEL 5: BUSINESS INTENT MATCH VIA EXPANSION (0.75)
  // The PRIMARY NOUN (or its own variations) must be present in the name, AND
  // a genuinely different qualifier token must also be present. This prevents
  // a single incidental token (e.g. "health", "business") from satisfying
  // both sides of the intent.
  const pnLower = intent.primaryNoun.toLowerCase();
  const primaryTerms = new Set<string>([pnLower]);
  for (const v of WORD_VARIATIONS[pnLower] ?? []) primaryTerms.add(v);

  const namePrimary = [...primaryTerms].some(t => t.length > 2 && nn.includes(t));
  const nameQualifierDistinct = intent.qualifiers.some(q => {
    const ql = q.toLowerCase();
    if (ql.length <= 2 || !nn.includes(ql)) return false;
    // The qualifier must not merely restate the primary concept
    return ![...primaryTerms].some(t => ql === t);
  });

  if (namePrimary && nameQualifierDistinct) {
    return {
      activityId: activity.id,
      matchType: "related",
      score: 0.75,
      reasons: [`Intent match: ${intent.primaryNoun} + qualifier (via expansion)`],
    };
  }

  // LEVEL 5b: EXPANDED TERM MATCH (0.68-0.72)
  // Only direct evidence counts: the term must be an ORIGINAL query word or
  // the primary noun itself. Distant sibling variations (e.g. "medical" for a
  // dental query) create false positives and are handled nowhere else.
  if (keywords.expandedTerms.length > 1) {
    const originalsAndPrimary = new Set([
      ...keywords.originalWords,
      intent.primaryNoun.toLowerCase(),
    ]);
    const expandedInName = [...originalsAndPrimary].filter(t => {
      if (t.length <= 3 || isGenericWord(t)) return false;
      if (getWordWeight(t) < 0.30) return false;
      return termAppearsUnnegated(nn, t);
    });
    if (expandedInName.length > 0) {
      const matchCount = expandedInName.length;
      const score = 0.68 + Math.min(matchCount * 0.02, 0.04);
      return {
        activityId: activity.id,
        matchType: "related",
        score: Math.round(score * 100) / 100,
        reasons: [`Expanded term match: ${expandedInName.slice(0, 3).join(", ")} in "${activity.officialName}"`],
      };
    }
  }

  // LEVEL 5c: DESCRIPTION SUPPORT MATCH (0.62-0.66)
  // The official activity NAME does not contain the concept, but the authority's
  // own description does. Conservative: requires the full phrase or 2+ original words.
  if (activity.description) {
    const desc = activity.description.toLowerCase();
    const phraseInDesc = nq.length > 2 && desc.includes(nq);
    const originalsInDesc = keywords.originalWords.filter(w => desc.includes(w));
    if (phraseInDesc || originalsInDesc.length >= 2) {
      const matchedList = phraseInDesc ? [nq] : originalsInDesc.slice(0, 3);
      const score = phraseInDesc ? 0.66 : 0.62 + Math.min(originalsInDesc.length * 0.01, 0.04);
      return {
        activityId: activity.id,
        matchType: "related",
        score: Math.round(score * 100) / 100,
        reasons: [`Authority description mentions: ${matchedList.join(", ")}`],
      };
    }
  }

  // LEVEL 6: CATEGORY MATCH (0.60-0.68)
  if (matchedOriginals.length >= 1) {
    const categoryMatch = activity.officialCategory && (
      activity.officialCategory.toLowerCase().includes(intent.industryDomain.toLowerCase()) ||
      intent.industryDomain.toLowerCase().includes(activity.officialCategory.toLowerCase())
    );
    const groupMatch = activity.activityGroup && (
      activity.activityGroup.toLowerCase().includes(intent.primaryNoun.toLowerCase()) ||
      intent.qualifiers.some(q => activity.activityGroup!.toLowerCase().includes(q.toLowerCase()))
    );

    if (categoryMatch || groupMatch) {
      const weightScore = matchedWeights.reduce((a, b) => a + b, 0) / matchedWeights.length;
      const score = 0.60 + Math.min(weightScore * 0.15, 0.08);
      return {
        activityId: activity.id,
        matchType: "related",
        score: Math.round(score * 100) / 100,
        reasons: [`Category/domain match: ${activity.officialCategory ?? activity.activityGroup} + keyword "${matchedOriginals[0]}"`],
      };
    }
  }

  // LEVEL 6b: SINGLE STRONG ORIGINAL WORD MATCH (0.60-0.72)
  if (matchedOriginals.length === 1) {
    const word = matchedOriginals[0];
    const weight = getWordWeight(word);

    if (!isGenericWord(word) && weight >= 0.40) {
      let score = 0.60 + (weight * 0.15);
      if (keywords.originalWords.length >= 2) {
        score *= 0.85;
      }
      score = Math.round(score * 100) / 100;
      return {
        activityId: activity.id,
        matchType: "related",
        score,
        reasons: [`Single domain word match: "${word}" (weight: ${weight})`],
      };
    }

    // LEVEL 6c: GENERIC WORD MATCH — broad queries only
    if (isGenericWord(word) && intent.isGenericQuery) {
      const weight = getWordWeight(word);
      const score = 0.58 + (weight * 0.50);
      if (score >= 0.58) {
        return {
          activityId: activity.id,
          matchType: "related",
          score: Math.round(score * 100) / 100,
          reasons: [`Generic query match: "${word}" in "${activity.officialName}"`],
        };
      }
    }
  }

  // LEVEL 7: BELOW THRESHOLD
  return null;
}

// ============================================================
// SECTION 8: CANDIDATE RETRIEVAL
// ============================================================

const MIN_RELEVANCE = 0.62;

type CandidateRow = {
  activity: typeof activities.$inferSelect;
  jurisdiction: typeof jurisdictions.$inferSelect;
  licenceType: typeof licenceTypes.$inferSelect | null;
  source: typeof sources.$inferSelect | null;
};

async function fetchCandidates(
  q: string,
  intent: BusinessIntent,
  keywords: ExtractedKeywords
): Promise<{ rows: CandidateRow[]; evaluated: number }> {
  const nq = keywords.originalWords.join(" ");
  const trimmed = q.trim();

  const baseSelect = () =>
    db
      .select({
        activity: activities,
        jurisdiction: jurisdictions,
        licenceType: licenceTypes,
        source: sources,
      })
      .from(activities)
      .innerJoin(jurisdictions, eq(activities.jurisdictionId, jurisdictions.id))
      .leftJoin(licenceTypes, eq(activities.licenceTypeId, licenceTypes.id))
      .leftJoin(
        sources,
        sql`EXISTS (SELECT 1 FROM ${activitySources} WHERE ${activitySources.activityId} = ${activities.id} AND ${activitySources.sourceId} = ${sources.id})`
      );

  const nonGenericExpanded = keywords.expandedTerms
    .filter(t => t.length > 3 && !isGenericWord(t))
    .slice(0, 4);

  const nameLen = sql`length(${activities.normalizedName})`;

  const [
    exactName,
    exactCode,
    nameContains,
    primaryNounMatches,
    expandedTermMatches,
    categoryMatches,
    descriptionMatches,
  ] = await Promise.all([
    // Tier 1: exact normalised name
    baseSelect().where(eq(activities.normalizedName, nq)).limit(50),
    // Tier 2: exact activity code
    trimmed.length <= 20
      ? baseSelect().where(eq(activities.activityCode, trimmed)).limit(20)
      : Promise.resolve([] as CandidateRow[]),
    // Tier 3: name contains full query phrase (shortest names first = most specific)
    nq.length >= 3
      ? baseSelect()
          .where(ilike(activities.normalizedName, `%${nq}%`))
          .orderBy(nameLen)
          .limit(300)
      : Promise.resolve([] as CandidateRow[]),
    // Tier 4: name contains primary noun (skipped for generic words)
    intent.primaryNoun.length > 2 && !isGenericWord(intent.primaryNoun)
      ? baseSelect()
          .where(ilike(activities.normalizedName, `%${intent.primaryNoun}%`))
          .orderBy(nameLen)
          .limit(250)
      : Promise.resolve([] as CandidateRow[]),
    // Tier 5: name contains expanded domain terms
    nonGenericExpanded.length > 0
      ? baseSelect()
          .where(
            or(
              ...nonGenericExpanded.map(t =>
                ilike(activities.normalizedName, `%${t}%`)
              )
            )
          )
          .orderBy(nameLen)
          .limit(200)
      : Promise.resolve([] as CandidateRow[]),
    // Tier 6: official category or activity group mentions an original word / primary noun
    nq.length >= 3
      ? baseSelect()
          .where(
            or(
              ...keywords.originalWords.slice(0, 4).map(w =>
                or(
                  ilike(activities.officialCategory, `%${w}%`),
                  ilike(activities.activityGroup, `%${w}%`)
                )
              ),
              ilike(activities.officialCategory, `%${intent.primaryNoun}%`),
              ilike(activities.activityGroup, `%${intent.primaryNoun}%`)
            )
          )
          .limit(150)
      : Promise.resolve([] as CandidateRow[]),
    // Tier 7: authority's own description mentions the phrase or primary noun
    nq.length >= 3
      ? baseSelect()
          .where(
            or(
              ilike(activities.description, `%${nq}%`),
              ilike(activities.description, `%${intent.primaryNoun}%`)
            )
          )
          .limit(150)
      : Promise.resolve([] as CandidateRow[]),
  ]);

  const all = [
    ...exactName,
    ...exactCode,
    ...nameContains,
    ...primaryNounMatches,
    ...expandedTermMatches,
    ...categoryMatches,
    ...descriptionMatches,
  ];

  return { rows: all, evaluated: all.length };
}

// ============================================================
// SECTION 9: MAIN SEARCH PIPELINE
// ============================================================

const TYPE_PRIORITY: Record<MatchType, number> = {
  exact: 0,
  strong: 1,
  related: 2,
  low_confidence: 3,
  ai_suggestion: 4,
};

interface PipelineOutput {
  items: SearchResultItem[];
  intent: BusinessIntent;
  candidatesEvaluated: number;
}

async function runPipeline(options: SearchOptions): Promise<PipelineOutput> {
  const { q } = options;

  const intent = detectBusinessIntent(q);
  const keywords = extractKeywords(q);

  if (keywords.originalWords.length === 0 && !/\d/.test(q)) {
    return { items: [], intent, candidatesEvaluated: 0 };
  }

  const { rows, evaluated } = await fetchCandidates(q, intent, keywords);

  const candidatesMap = new Map<string, { row: CandidateRow; bestScore: ScoredResult }>();

  for (const row of rows) {
    const id = row.activity.id;
    const scored = scoreActivity(intent, keywords, {
      id: row.activity.id,
      officialName: row.activity.officialName,
      normalizedName: row.activity.normalizedName,
      activityCode: row.activity.activityCode,
      description: row.activity.description,
      officialCategory: row.activity.officialCategory,
      activityGroup: row.activity.activityGroup,
    });
    if (!scored) continue;

    const existing = candidatesMap.get(id);
    if (!existing || scored.score > existing.bestScore.score) {
      candidatesMap.set(id, { row, bestScore: scored });
    }
  }

  const items: SearchResultItem[] = [];

  for (const { row, bestScore } of candidatesMap.values()) {
    if (bestScore.score < MIN_RELEVANCE) continue;

    if (options.emirate && row.jurisdiction.emirate !== options.emirate) continue;
    if (options.jurisdictionType && row.jurisdiction.jurisdictionType !== options.jurisdictionType) continue;
    if (options.jurisdictionId && row.jurisdiction.id !== options.jurisdictionId) continue;
    if (options.approvalStatus && row.activity.approvalStatus !== options.approvalStatus) continue;
    if (options.licenceType && row.licenceType?.name !== options.licenceType) continue;
    if (options.verifiedOnly && row.activity.verificationStatus !== "verified") continue;

    items.push({
      activity: {
        id: row.activity.id,
        officialName: row.activity.officialName,
        normalizedName: row.activity.normalizedName,
        activityCode: row.activity.activityCode,
        description: row.activity.description,
        officialCategory: row.activity.officialCategory,
        activityGroup: row.activity.activityGroup,
        approvalSignal: row.activity.approvalSignal,
        approvalStatus: row.activity.approvalStatus,
        verificationStatus: row.activity.verificationStatus,
        lastVerified: row.activity.lastVerified?.toString() ?? null,
      },
      jurisdiction: {
        id: row.jurisdiction.id,
        name: row.jurisdiction.name,
        slug: row.jurisdiction.slug,
        emirate: row.jurisdiction.emirate,
        jurisdictionType: row.jurisdiction.jurisdictionType,
      },
      licenceType: row.licenceType
        ? { id: row.licenceType.id, name: row.licenceType.name, code: row.licenceType.code }
        : null,
      matchType: bestScore.matchType,
      matchScore: bestScore.score,
      matchReasons: bestScore.reasons,
      source: row.source
        ? {
            id: row.source.id,
            url: row.source.url,
            title: row.source.title,
            lastVerified: row.source.lastVerified?.toString() ?? null,
          }
        : null,
    });
  }

  items.sort((a, b) => {
    const td = TYPE_PRIORITY[a.matchType] - TYPE_PRIORITY[b.matchType];
    if (td !== 0) return td;
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    // Deterministic tie-break
    return a.activity.officialName.localeCompare(b.activity.officialName) ||
      a.jurisdiction.slug.localeCompare(b.jurisdiction.slug);
  });

  return { items, intent, candidatesEvaluated: evaluated };
}

/** Flat, paginated search results (backwards-compatible entry point). */
export async function search(options: SearchOptions): Promise<SearchResultItem[]> {
  const { limit = 20, offset = 0 } = options;
  const { items } = await runPipeline(options);
  return items.slice(offset, offset + limit);
}

/**
 * Unified search: flat paginated results PLUS per-jurisdiction grouping and
 * explicit availability across every indexed jurisdiction.
 */
export async function searchUnified(options: SearchOptions): Promise<UnifiedSearchResponse> {
  const startedAt = Date.now();
  const { limit = 20, offset = 0, groupLimit = 8 } = options;

  const { items, intent, candidatesEvaluated } = await runPipeline(options);

  // Flat page
  const results = items.slice(offset, offset + limit);

  // Group ALL matches by jurisdiction
  const grouped = new Map<string, JurisdictionGroup>();
  for (const item of items) {
    let group = grouped.get(item.jurisdiction.id);
    if (!group) {
      group = {
        jurisdiction: item.jurisdiction,
        status: "match",
        totalMatches: 0,
        bestMatchType: item.matchType,
        topResults: [],
      };
      grouped.set(item.jurisdiction.id, group);
    }
    group.totalMatches += 1;
    const currentBest = group.bestMatchType ? TYPE_PRIORITY[group.bestMatchType] : 99;
    if (
      TYPE_PRIORITY[item.matchType] < currentBest ||
      (TYPE_PRIORITY[item.matchType] === currentBest &&
        item.matchScore > (group.topResults[0]?.matchScore ?? 0))
    ) {
      group.bestMatchType = item.matchType;
    }
    if (group.topResults.length < groupLimit) {
      group.topResults.push(item);
    }
  }

  // Every jurisdiction whose official activity data is actually imported must
  // report availability explicitly. Registry placeholder rows without any
  // imported activity are excluded.
  const allJurisdictions = await db
    .selectDistinct({
      id: jurisdictions.id,
      slug: jurisdictions.slug,
      name: jurisdictions.name,
      emirate: jurisdictions.emirate,
      jurisdictionType: jurisdictions.jurisdictionType,
    })
    .from(jurisdictions)
    .innerJoin(activities, eq(activities.jurisdictionId, jurisdictions.id));

  const jurisdictionGroups: JurisdictionGroup[] = [];
  const unmatched: SearchAvailability["unmatched"] = [];

  for (const j of allJurisdictions) {
    const group = grouped.get(j.id);
    if (group) {
      jurisdictionGroups.push(group);
    } else {
      unmatched.push(j);
      jurisdictionGroups.push({
        jurisdiction: j,
        status: "no_match",
        totalMatches: 0,
        bestMatchType: null,
        topResults: [],
      });
    }
  }

  jurisdictionGroups.sort((a, b) => b.totalMatches - a.totalMatches ||
    a.jurisdiction.name.localeCompare(b.jurisdiction.name));

  return {
    query: options.q,
    total: items.length,
    results,
    jurisdictionGroups,
    availability: {
      matchedJurisdictionSlugs: jurisdictionGroups.filter(g => g.status === "match").map(g => g.jurisdiction.slug),
      unmatched,
    },
    intent: {
      primaryNoun: intent.primaryNoun,
      industryDomain: intent.industryDomain,
      specificityLevel: intent.specificityLevel,
      isGenericQuery: intent.isGenericQuery,
    },
    meta: {
      tookMs: Date.now() - startedAt,
      candidatesEvaluated,
      minRelevanceThreshold: MIN_RELEVANCE,
    },
  };
}

// ============================================================
// SECTION 10: AI SUGGESTIONS (for no-result scenarios)
// ============================================================

export function generateAISuggestions(query: string, intent: BusinessIntent): string[] {
  const suggestions: string[] = [];
  for (const q of intent.qualifiers) {
    suggestions.push(q);
  }
  for (const t of intent.requiredTerms) {
    if (!suggestions.includes(t)) suggestions.push(t);
  }
  return suggestions.slice(0, 5);
}
