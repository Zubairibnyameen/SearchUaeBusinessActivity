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
import { sql, type SQL } from "drizzle-orm";
import type {
  MatchType,
  BusinessIntent,
  SearchResultItem,
  JurisdictionGroup,
  ApprovalSignalValue,
  SearchAvailability,
  UnifiedSearchResponse,
  SearchOptions,
} from "./types";
import { parseQuery, type ParsedQuery } from "./query-parser";

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
  store: 0.35, shop: 0.35, outlet: 0.35, outlets: 0.35, marketplace: 0.40,
  ecommerce: 0.45, "e-commerce": 0.45, dropshipping: 0.45, dropship: 0.45,
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

/**
 * Domain weight of a query word.
 *
 * Falls back to the strongest weight across the word's singular/plural
 * counterparts. `WORD_WEIGHTS` is written in the singular ("restaurant",
 * "shop"), but users type both forms, and without this a plural query word
 * scored the 0.20 unknown-word default and was then discarded by every
 * weight gate downstream - which is why "restaurants" ranked unrelated
 * activities above the exact "Restaurant" ones.
 */
function getWordWeight(word: string): number {
  const lower = word.toLowerCase();
  if (WORD_WEIGHTS[lower] !== undefined) return WORD_WEIGHTS[lower];
  for (const variant of morphologicalVariants(lower)) {
    if (WORD_WEIGHTS[variant] !== undefined) return WORD_WEIGHTS[variant];
  }
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
  marketing: ["marketing", "market", "marketed", "marketer", "marketers"],
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
  store: ["store", "stores", "shop", "shops", "retail", "outlet", "outlets"],
  shop: ["shop", "shops", "store", "stores", "retail", "outlet", "outlets"],
  retail: ["retail", "retailer", "retailers", "retailing", "store", "shop"],
  ecommerce: ["e-commerce", "ecommerce", "online", "retail", "marketplace", "internet"],
  organisation: ["organisation", "organisations", "organization", "organizations"],
  organization: ["organization", "organizations", "organisation", "organisations"],
  licence: ["licence", "licences", "license", "licenses"],
  license: ["license", "licenses", "licence", "licences"],
  programme: ["programme", "programmes", "program", "programs"],
  program: ["program", "programs", "programme", "programmes"],
  advisor: ["advisor", "advisors", "adviser", "advisers", "advisory"],
  restaurant: ["restaurant", "restaurants", "food outlet", "food outlets", "eatery", "eateries"],
  wholesale: ["wholesale", "wholesaler", "wholesalers", "import", "exports", "distributor", "distributors"],
};

/**
 * Semantic family of a concept: the word itself plus the members of the
 * variation family keyed by that word; if the word has no family of its own,
 * the first family that contains it is used (e.g. the concept "garment"
 * borrows the "clothing" family). This bridges Headword → official wording
 * (query "online clothing store" matches an activity named "Clothing
 * Trading") WITHOUT letting a concept balloon into sibling domains (e.g.
 * "clinic" never matches on "health"/"hospital" alone).
 */
function primaryConceptTerms(primaryNoun: string): Set<string> {
  const lower = primaryNoun.toLowerCase();
  const terms = new Set<string>([lower]);
  const own = WORD_VARIATIONS[lower];
  if (own) {
    own.forEach((v) => terms.add(v));
    return terms;
  }
  for (const family of Object.values(WORD_VARIATIONS)) {
    if (family.includes(lower)) {
      family.forEach((v) => terms.add(v));
      break;
    }
  }
  return terms;
}

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
      primaryNoun: "ecommerce",
      qualifiers: ["online", "ecommerce", "retail", "internet", "digital", "marketplace"],
      industryDomain: "retail",
      requiredTerms: ["ecommerce", "e-commerce", "trading", "retail", "marketplace"],
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
    pattern: /^restaurant\b|^cafe\b|^coffee\s+shop|\brestaurant\b/i,
    intent: {
      primaryNoun: "restaurant",
      qualifiers: ["cafe", "food", "beverage", "catering"],
      industryDomain: "food",
      requiredTerms: ["restaurant"],
      // Equipment/supply trading names are NOT excluded — they are capped to
      // "related" by the goods-context downgrade so they never surface as
      // strong/exact unless the query explicitly asks for equipment. Pure
      // consultancy for restaurants is a different line of business.
      excludedTerms: ["consultancy", "consultation", "consulting"],
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
  {
    // "online clothing store" / "start an online clothing shop" / "online shop for clothes"
    pattern:
      /^online\s+(clothing|garments?|apparel|fashion|clothes)|^online\s+(store|shop)s?\s+(for\s+|and\s+)?(clothing|garments?|apparel|fashion|clothes)/i,
    intent: {
      primaryNoun: "garment",
      qualifiers: ["clothing", "apparel", "fashion", "textile", "online", "retail"],
      industryDomain: "retail",
      requiredTerms: ["garment", "garments", "clothing", "apparel", "fashion", "textile", "clothes"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^clothing\s+(store|shop|retail|line|brand)|^garments?\s+(store|shop|retail)/i,
    intent: {
      primaryNoun: "garment",
      qualifiers: ["clothing", "apparel", "fashion", "textile", "store", "retail"],
      industryDomain: "retail",
      requiredTerms: ["garment", "garments", "clothing", "apparel", "fashion", "textile"],
      excludedTerms: [],
    },
  },
  {
    pattern:
      /^(womens?|ladies?|mens?|kids?|childrens?|babys?)\s+(clothing|garments?|apparel|fashion|clothes)(\s+(store|shop|outlet|studio|brand|line))?/i,
    intent: {
      primaryNoun: "garment",
      qualifiers: ["clothing", "apparel", "fashion", "textile", "store", "retail"],
      industryDomain: "retail",
      requiredTerms: ["garment", "garments", "clothing", "apparel", "fashion", "textile"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^(jewellery|jewelry)\s+(store|shop|retail)/i,
    intent: {
      primaryNoun: "jewellery",
      qualifiers: ["store", "shop", "retail", "gold", "diamond", "precious"],
      industryDomain: "precious metals",
      requiredTerms: ["jewellery", "jewelry", "gold", "precious"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^(property|real\s+estate)\s+brokerage/i,
    intent: {
      primaryNoun: "brokerage",
      qualifiers: ["property", "real estate", "estate", "sales purchase"],
      industryDomain: "real estate",
      requiredTerms: ["brokerage", "broker", "broking"],
      excludedTerms: ["mortgage", "consultancy", "development", "leasing", "promotion", "survey", "valuation", "supervision", "representative"],
    },
  },
  {
    pattern: /^(car|vehicle|automobile)s?\s+rental|^rental\s+(of\s+)?(car|vehicle|automobile)s?/i,
    intent: {
      primaryNoun: "rental",
      qualifiers: ["car", "vehicle", "automobile"],
      industryDomain: "transport",
      requiredTerms: ["rental"],
      excludedTerms: ["equipment", "machinery"],
    },
  },
  {
    pattern: /^(training|education|learning)\s+(institute|centre|center|academy|courses?)/i,
    intent: {
      primaryNoun: "training",
      qualifiers: ["education", "institute", "academy", "courses"],
      industryDomain: "education",
      requiredTerms: ["training", "education", "institute", "academy"],
      excludedTerms: ["badminton", "basketball", "ping pong", "squash", "tennis", "volleyball", "wrestling", "swimming", "ice skating", "football", "cricket", "chess", "gaming", "sports"],
    },
  },
  {
    pattern: /^shipping\s+(company|lines?|services|agents?)|^shipping\s+and?\s+(logistics|freight|cargo)/i,
    intent: {
      primaryNoun: "logistics",
      qualifiers: ["shipping", "freight", "cargo", "transport"],
      industryDomain: "logistics",
      requiredTerms: ["logistics", "shipping", "freight", "cargo"],
      excludedTerms: [],
    },
  },
  {
    pattern: /^import(ing)?\s+(of\s+)?(electronics|electronic\s+goods|consumer\s+electronics|mobile|phones)/i,
    intent: {
      primaryNoun: "electronics",
      qualifiers: ["import", "electronic", "electrical", "computer", "mobile"],
      industryDomain: "consumer electronics",
      requiredTerms: ["electronics", "electronic", "mobile"],
      excludedTerms: ["waste", "scrap"],
    },
  },
  {
    pattern: /^marketing\s+(agency|company|firm|services|consultancy)/i,
    intent: {
      primaryNoun: "marketing",
      qualifiers: ["digital", "online", "advertising", "branding"],
      industryDomain: "media",
      requiredTerms: ["marketing"],
      excludedTerms: ["travel", "insurance", "shipping"],
    },
  },
  {
    pattern: /^(food|restaurant|coffee|beverage)\s+(outlet|franchise|chain)/i,
    intent: {
      primaryNoun: "restaurant",
      qualifiers: ["cafe", "food", "beverage", "catering", "outlet"],
      industryDomain: "food",
      requiredTerms: ["restaurant", "food", "coffee"],
      excludedTerms: ["consultancy"],
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

  if (words.length === 0) {
    return {
      primaryNoun: q,
      qualifiers: [],
      industryDomain: "general",
      requiredTerms: [],
      excludedTerms: [],
      isGenericQuery: true,
      specificityLevel: "broad",
    };
  }

  let primaryNoun: string;
  let qualifiers: string[];
  if (words.length >= 2) {
    const specificWord = words.find(w => !isGenericWord(w)) || words[0];
    primaryNoun = specificWord;
    qualifiers = words.filter(w => w !== specificWord);
  } else {
    primaryNoun = words[0];
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
  /** Published ISIC classification code; searched as an exact-code tier. */
  isicCode: string | null;
  description: string | null;
  officialCategory: string | null;
  activityGroup: string | null;
}

/** Regular plural -> singular. Null when the word has no confident singular. */
function singularize(term: string): string | null {
  const t = term.toLowerCase();
  if (t.length < 4) return null;
  if (t.endsWith("sses")) return t.slice(0, -2); // businesses -> business
  if (/(?:shes|ches|xes|zes)$/.test(t)) return t.slice(0, -2); // dishes -> dish, boxes -> box
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`; // categories -> category
  // "ss"/"us"/"is" endings are left alone so business, campus and analysis
  // are never cut down to busine/campu/analysi.
  if (t.endsWith("s") && !/(?:ss|us|is)$/.test(t)) return t.slice(0, -1);
  return null;
}

/** Regular singular -> plural. Null when not confidently pluralisable. */
function pluralize(term: string): string | null {
  const t = term.toLowerCase();
  if (t.length < 3 || t.endsWith("s")) return null;
  if (t.endsWith("y") && !/[aeiou]y$/.test(t)) return `${t.slice(0, -1)}ies`;
  if (/(?:x|z|ch|sh)$/.test(t)) return `${t}es`;
  return `${t}s`;
}

/**
 * Both regular counterparts of a term, in either direction.
 *
 * Activity names in this catalogue are inconsistently pluralised - the same
 * concept appears as both "Restaurant" and "Restaurants and mobile food service
 * activities" - so a query for one form must reach the other. Without this,
 * "restaurants" scored every "Restaurant" activity below unrelated results,
 * because the scorer compares whole words and `\brestaurants\b` does not match
 * "Restaurant".
 */
function morphologicalVariants(term: string): string[] {
  const t = term.toLowerCase();
  if (t.length < 3) return [];
  const out: string[] = [];
  const singular = singularize(t);
  if (singular) out.push(singular);
  const plural = pluralize(t);
  if (plural) out.push(plural);
  return out;
}

/**
 * Reduces every token to its singular so two phrases differing only by
 * pluralisation produce the SAME string.
 *
 * This has to normalise one way only. Folding each token to whichever form the
 * rule happens to produce is not a canonical form: "restaurant" would become
 * "restaurants" while "restaurants" became "restaurant", so an exact-equality
 * comparison would still fail.
 */
function canonicalInflection(phrase: string): string {
  return phrase
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => singularize(token) ?? token)
    .join(" ");
}

/** Whole-word containment, ignoring occurrences negated by "non-X"/"not X". */
function termAppearsUnnegated(haystack: string, term: string): boolean {
  const variants = [term, ...morphologicalVariants(term)];
  for (const variant of variants) {
    if (wholeWordUnnegated(haystack, variant)) return true;
  }
  return false;
}

function wholeWordUnnegated(haystack: string, term: string): boolean {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b`, "i");
  if (!re.test(haystack)) {
    // e-commerce / ecommerce equivalence: retry with internal hyphens stripped
    // on BOTH sides so word-boundary matching works for either spelling.
    const flatEsc = esc.replace(/-/g, "");
    const flatHaystack = haystack.replace(/-/g, "");
    if (flatEsc === esc && flatHaystack === haystack) return false;
    const flatRe = new RegExp(`\\b${flatEsc}\\b`, "i");
    if (!flatRe.test(flatHaystack)) return false;
    const flatNegRe = new RegExp(`\\b(?:non|not)[-\\s]?${flatEsc}\\b`, "i");
    return !flatNegRe.test(flatHaystack);
  }
  const negRe = new RegExp(`\\b(?:non[-\\s]?|not[-\\s])${esc}\\b`, "i");
  return !negRe.test(haystack);
}

function scoreActivity(
  intent: BusinessIntent,
  keywords: ExtractedKeywords,
  activity: ScoreInput,
  rawQuery: string
): ScoredResult | null {
  const nn = activity.normalizedName;
  const nq = keywords.originalWords.join(" ");

  /*
    Codes must be compared against the raw query, not `nq`.

    `nq` is the query re-joined from word tokens, so a published code such as
    "1520-05" or "0160.00" arrives here as "1520 05" / "0160 00" and can never
    equal the stored value. Retrieval already matched the row on the raw string;
    the exact-code tier then rejected it and the row was dropped from the
    results. Whitespace is the only thing removed on both sides - punctuation
    stays significant, because "1520-05" and "1520.05" are different codes.
  */
  const rawCodeQuery = rawQuery.trim().replace(/\s/g, "").toLowerCase();

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
    return { activityId: activity.id, matchType: "exact", score: 1.0, reasons: [`Exact official activity match: "${activity.officialName}"`] };
  }

  // Same name, differing only in pluralisation ("restaurants" vs "Restaurant").
  // Scored identically so the plural form of a query is not a downgrade.
  if (canonicalInflection(nn) === canonicalInflection(nq)) {
    return {
      activityId: activity.id,
      matchType: "exact",
      score: 1.0,
      reasons: [`Exact official activity match (plural form): "${activity.officialName}"`],
    };
  }

  // LEVEL 2: EXACT CODE MATCH (0.98)
  // No shape test here: activity codes in this catalogue are alphanumeric
  // ("abc123", "0160.00", "1520-05"). Comparing the whitespace-stripped raw
  // query is already specific, and it only ever fires on a row that retrieval
  // actually returned for this query.
  if (
    activity.activityCode &&
    rawCodeQuery === activity.activityCode.replace(/\s/g, "").toLowerCase()
  ) {
    return { activityId: activity.id, matchType: "exact", score: 0.98, reasons: ["Exact activity code match"] };
  }

  // LEVEL 2b: EXACT ISIC CLASSIFICATION CODE (0.97)
  // Scored just below the activity code because a published ISIC code is a
  // broader industry classification, while the activity code identifies the
  // specific regulated activity.
  if (
    activity.isicCode &&
    rawCodeQuery === activity.isicCode.replace(/\s/g, "").toLowerCase()
  ) {
    return {
      activityId: activity.id,
      matchType: "exact",
      score: 0.97,
      reasons: [`Exact ISIC classification code match: ${activity.isicCode}`],
    };
  }

  // LEVEL 3: HIGH CONFIDENCE PHRASE (0.92)
  // Primary noun in the name + a qualifier (or a term from the qualifier's own
  // variation family) also present. A "Cardiac Clinic" satisfies the medical
  // qualifier because "clinic" belongs to the same concept family.
  const primaryInName = [...primaryConceptTerms(intent.primaryNoun)].some(t => t.length > 2 && nn.includes(t));
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

  if (!isGenericWord(intent.primaryNoun) && primaryInName && qualifierInName) {
    return {
      activityId: activity.id,
      matchType: "strong",
      score: 0.92,
      reasons: [`Matched: ${intent.qualifiers[0] ?? intent.primaryNoun} ${intent.primaryNoun} — "${activity.officialName}"`],
    };
  }

  // LEVEL 4: STRONG MULTI-TERM (0.78-0.90)
  const matchedOriginals = keywords.originalWords.filter(w => termAppearsUnnegated(nn, w));
  const matchedWeights = matchedOriginals.map(w => getWordWeight(w));
  const avgWeight = matchedWeights.length > 0 ? matchedWeights.reduce((a, b) => a + b, 0) / matchedWeights.length : 0;

  if (matchedOriginals.length >= 2) {
    // Generic-only terms (e.g. "trading company") must never rank as strong.
    if (matchedOriginals.every(w => isGenericWord(w))) {
      return {
        activityId: activity.id,
        matchType: "related",
        score: 0.70,
        reasons: [`Related match on generic terms "${matchedOriginals.join(", ")}" — "${activity.officialName}"`],
      };
    }
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
        reasons: [`Matched: ${matchedOriginals.join(" + ")} — "${activity.officialName}"`],
      };
    }
  }

  // LEVEL 5: BUSINESS INTENT MATCH VIA EXPANSION (0.75)
  // The PRIMARY NOUN (or its own variations) must be present in the name, AND
  // a genuinely different qualifier token must also be present. This prevents
  // a single incidental token (e.g. "health", "business") from satisfying
  // both sides of the intent.
  const pnLower = intent.primaryNoun.toLowerCase();
  const primaryTerms = primaryConceptTerms(pnLower);

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
      reasons: [`Matched: ${intent.primaryNoun} (+ ${intent.qualifiers.slice(0, 2).join(", ")}) — "${activity.officialName}"`],
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
        reasons: [`Related term match: ${expandedInName.slice(0, 3).join(", ")} — "${activity.officialName}"`],
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
      const score = phraseInDesc ? 0.66 : 0.62 + Math.min(originalsInDesc.length * 0.01, 0.04);
      return {
        activityId: activity.id,
        matchType: "related",
        score: Math.round(score * 100) / 100,
        reasons: [`Listed by the authority: "${activity.officialName}" (${nq} appears in the official description)`],
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
        reasons: [`Matches the ${intent.industryDomain} category behind "${matchedOriginals[0]}"`],
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
        reasons: [`Related match on "${word}" (a ${intent.industryDomain} concept)`],
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
          reasons: [`Matched "${word}" in "${activity.officialName}"`],
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
  activity: {
    id: string;
    officialName: string;
    normalizedName: string;
    activityCode: string | null;
    isicCode: string | null;
    description: string | null;
    officialCategory: string | null;
    activityGroup: string | null;
    approvalSignal: ApprovalSignalValue;
    approvalStatus: string;
    verificationStatus: string;
    lastVerified: string | null;
  };
  jurisdiction: {
    id: string;
    name: string;
    slug: string;
    emirate: string;
    jurisdictionType: string;
  };
  licenceType: { id: string; name: string; code: string } | null;
  source: { id: string; url: string; title: string; lastVerified: string | null } | null;
};

type AvailabilityRow = {
  id: string;
  slug: string;
  name: string;
  emirate: string;
  jurisdictionType: string;
};

/**
 * Performance (STEP 6.1): all seven retrieval tiers are executed in a SINGLE
 * UNION ALL query. On the remote Neon database each round trip costs ~290ms of
 * WAN latency, so the historical "7 queries in parallel" pattern serialized to
 * ~1900ms/p50. One parenthesised UNION (per-branch ORDER BY/LIMIT preserved)
 * keeps every tier's exact candidate semantics while collapsing to a single
 * network round trip (~300ms).
 *
 * Each branch mirrors the previous drizzle chain EXACTLY:
 *   - same WHERE predicates, same ORDER BY length(normalized_name), same LIMIT
 *   - identical joins (jurisdiction inner, licenceType + source left)
 * Only the column projection is narrowed to the fields the scorer and the
 * response actually consume (activity payload drops ~40% of row width).
 */
const CANDIDATE_SELECT = `
  activities.id AS a_id,
  activities.official_name AS a_official_name,
  activities.normalized_name AS a_normalized_name,
  activities.activity_code AS a_activity_code,
  activities.isic_code AS a_isic_code,
  activities.description AS a_description,
  activities.official_category AS a_official_category,
  activities.activity_group AS a_activity_group,
  activities.approval_signal AS a_approval_signal,
  activities.approval_status AS a_approval_status,
  activities.verification_status AS a_verification_status,
  activities.last_verified AS a_last_verified,
  jurisdictions.id AS j_id,
  jurisdictions.name AS j_name,
  jurisdictions.slug AS j_slug,
  jurisdictions.emirate AS j_emirate,
  jurisdictions.jurisdiction_type AS j_jurisdiction_type,
  licence_types.id AS lt_id,
  licence_types.name AS lt_name,
  licence_types.code AS lt_code,
  sources.id AS s_id,
  sources.url AS s_url,
  sources.title AS s_title,
  sources.last_verified AS s_last_verified`;

const CANDIDATE_FROM = `
  FROM activities
  INNER JOIN jurisdictions ON jurisdictions.id = activities.jurisdiction_id
  LEFT JOIN licence_types ON licence_types.id = activities.licence_type_id
  LEFT JOIN sources ON EXISTS (
    SELECT 1 FROM activity_sources
    WHERE activity_sources.activity_id = activities.id
      AND activity_sources.source_id = sources.id
  )`;

/**
 * ILIKE pattern for a bind parameter. The `%` wildcards are added here, in JS,
 * so the term itself crosses the boundary as a value — never as SQL text. (The
 * `%`/`_` inside a user term remain LIKE wildcards, which is the intended fuzzy
 * behaviour of a search box, not an injection vector.)
 *
 * This replaced `sqlLit`/`likeLit` string-building: under Postgres'
 * `standard_conforming_strings=on` those were not exploitable, but a trailing
 * backslash produced `LIKE pattern must not end with escape character` and the
 * whole construction was one `sql.raw` away from injection.
 */
function likeParam(term: string): string {
  return `%${term}%`;
}

function mapCandidateRow(r: Record<string, unknown>): CandidateRow {
  const d = (v: unknown): string | null => (v == null ? null : String(v));
  return {
    activity: {
      id: String(r.a_id),
      officialName: String(r.a_official_name),
      normalizedName: String(r.a_normalized_name),
      activityCode: r.a_activity_code == null ? null : String(r.a_activity_code),
      isicCode: r.a_isic_code == null ? null : String(r.a_isic_code),
      description: d(r.a_description),
      officialCategory: d(r.a_official_category),
      activityGroup: d(r.a_activity_group),
      approvalSignal: String(r.a_approval_signal) as ApprovalSignalValue,
      approvalStatus: String(r.a_approval_status),
      verificationStatus: String(r.a_verification_status),
      lastVerified: d(r.a_last_verified),
    },
    jurisdiction: {
      id: String(r.j_id),
      name: String(r.j_name),
      slug: String(r.j_slug),
      emirate: String(r.j_emirate),
      jurisdictionType: String(r.j_jurisdiction_type),
    },
    licenceType:
      r.lt_id == null
        ? null
        : { id: String(r.lt_id), name: String(r.lt_name), code: String(r.lt_code) },
    source:
      r.s_id == null
        ? null
        : {
            id: String(r.s_id),
            url: String(r.s_url),
            title: String(r.s_title),
            lastVerified: d(r.s_last_verified),
          },
  };
}

async function fetchCandidates(
  q: string,
  intent: BusinessIntent,
  keywords: ExtractedKeywords,
  includeAvailability = false
): Promise<{ rows: CandidateRow[]; evaluated: number; availability: AvailabilityRow[] }> {
  const nq = keywords.originalWords.join(" ");
  const trimmed = q.trim();

  const nonGenericExpanded = keywords.expandedTerms
    .filter(t => t.length > 3 && !isGenericWord(t))
    .slice(0, 4);

  const branches: SQL[] = [];
  const selectFrom = sql`${sql.raw(CANDIDATE_SELECT)} ${sql.raw(CANDIDATE_FROM)}`;

  // Tier 1: exact normalised name
  branches.push(
    sql`SELECT ${selectFrom} WHERE activities.normalized_name = ${nq} LIMIT 20`
  );
  // Tier 2: exact activity code
  if (trimmed.length <= 20) {
    branches.push(
      sql`SELECT ${selectFrom} WHERE activities.activity_code = ${trimmed} LIMIT 10`
    );
  }
  // Tier 2b: exact ISIC classification code.
  // ISIC codes were previously selected but never searched, so a published
  // classification code returned nothing at all. Gated to numeric-looking
  // queries so ordinary word searches do not pay for another branch.
  if (/^[0-9][0-9.\-/]*$/.test(trimmed) && trimmed.length <= 20) {
    branches.push(
      sql`SELECT ${selectFrom} WHERE activities.isic_code = ${trimmed} LIMIT 10`
    );
  }
  // Tier 3: name contains full query phrase (shortest names first = most specific)
  if (nq.length >= 3) {
    branches.push(
      sql`SELECT ${selectFrom} WHERE activities.normalized_name ILIKE ${likeParam(nq)} ORDER BY length(activities.normalized_name) LIMIT 200`
    );
  }
  // Tier 4: name contains primary noun (skipped for generic words)
  if (intent.primaryNoun.length > 2 && !isGenericWord(intent.primaryNoun)) {
    branches.push(
      sql`SELECT ${selectFrom} WHERE activities.normalized_name ILIKE ${likeParam(intent.primaryNoun)} ORDER BY length(activities.normalized_name) LIMIT 150`
    );
  }
  // Tier 5: name contains expanded domain terms
  if (nonGenericExpanded.length > 0) {
    const nameConds = nonGenericExpanded.map(
      t => sql`activities.normalized_name ILIKE ${likeParam(t)}`
    );
    branches.push(
      sql`SELECT ${selectFrom} WHERE (${sql.join(nameConds, sql` OR `)}) ORDER BY length(activities.normalized_name) LIMIT 120`
    );
  }
  // Tier 6: official category or activity group mentions an original word / primary noun
  if (nq.length >= 3) {
    const categoryConjs = keywords.originalWords.slice(0, 4).map(
      w => sql`(activities.official_category ILIKE ${likeParam(w)} OR activities.activity_group ILIKE ${likeParam(w)})`
    );
    categoryConjs.push(
      sql`activities.official_category ILIKE ${likeParam(intent.primaryNoun)} OR activities.activity_group ILIKE ${likeParam(intent.primaryNoun)}`
    );
    branches.push(
      sql`SELECT ${selectFrom} WHERE (${sql.join(categoryConjs, sql` OR `)}) LIMIT 80`
    );
  }
  // Tier 7: authority's own description mentions the phrase or primary noun
  if (nq.length >= 3) {
    branches.push(
      sql`SELECT ${selectFrom} WHERE (activities.description ILIKE ${likeParam(nq)} OR activities.description ILIKE ${likeParam(intent.primaryNoun)}) LIMIT 80`
    );
  }

  if (branches.length === 0 && !includeAvailability) {
    return { rows: [], evaluated: 0, availability: [] };
  }

  // STEP 6.1: when searchUnified needs jurisdiction availability, fold the
  // (previously separate) DISTINCT query into the SAME union so the whole
  // response costs exactly ONE network round trip instead of two.
  if (includeAvailability) {
    branches.push(
      sql.raw(`SELECT DISTINCT
        NULL::uuid AS a_id, NULL::text AS a_official_name, NULL::text AS a_normalized_name,
        NULL::varchar AS a_activity_code,
        NULL::varchar AS a_isic_code,
        NULL::text AS a_description,
        NULL::varchar AS a_official_category, NULL::varchar AS a_activity_group,
        NULL::approval_signal AS a_approval_signal, NULL::approval_status AS a_approval_status,
        NULL::verification_status AS a_verification_status, NULL::date AS a_last_verified,
        jurisdictions.id AS j_id, jurisdictions.name AS j_name, jurisdictions.slug AS j_slug,
        jurisdictions.emirate AS j_emirate, jurisdictions.jurisdiction_type AS j_jurisdiction_type,
        NULL::uuid AS lt_id, NULL::varchar AS lt_name, NULL::varchar AS lt_code,
        NULL::uuid AS s_id, NULL::varchar AS s_url, NULL::varchar AS s_title, NULL::date AS s_last_verified
        FROM jurisdictions
        INNER JOIN activities ON activities.jurisdiction_id = jurisdictions.id`)
    );
  }

  // Parentheses around every branch are REQUIRED so each SELECT's own
  // ORDER BY / LIMIT is honoured inside the set operation. Every user-derived
  // value crosses into the query as a bind parameter ($1, $2, ...), not text.
  const unionQuery = sql.join(
    branches.map(b => sql`(${b})`),
    sql`\nUNION ALL\n`
  );

  const result = await db.execute(unionQuery);
  const arr = Array.isArray(result)
    ? result
    : (result as { rows?: unknown[] }).rows ?? (result as unknown[])[0] ?? [];

  const flat = arr as Record<string, unknown>[];
  const rows = flat.filter(r => r.a_id != null).map(mapCandidateRow);
  const availability: AvailabilityRow[] = includeAvailability
    ? flat
        .filter(r => r.a_id == null && r.j_id != null)
        .map(r => ({
          id: String(r.j_id),
          slug: String(r.j_slug),
          name: String(r.j_name),
          emirate: String(r.j_emirate),
          jurisdictionType: String(r.j_jurisdiction_type),
        }))
    : [];

  return { rows, evaluated: rows.length, availability };
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
  parsed: ParsedQuery;
  candidatesEvaluated: number;
  availability: AvailabilityRow[];
}

/**
 * The activity clearly trades/supplies goods or equipment for a domain rather
 * than operating the domain itself. E.g. query "restaurant" should never rank
 * "Wholesale of Restaurants and Kitchens Equipment and Outfit Trading" as a
 * strong match — but the user may still be interested, so we cap it to RELATED.
 */
const GOODS_CONTEXT_MARKERS =
  /\b(equipment|machiner(?:y|ies)|machines?|tools?|devices?|apparatus|supplies?|requisites?|instruments?|fixtures?|furnishings?|fit[\s-]?outs?|outfits?|spare\s+parts?|wholesale|import|retail\s+of)\b/i;

function capGoodsContextMatch(
  officialName: string,
  intent: BusinessIntent,
  bestScore: ScoredResult,
  queryAsksForGoods: boolean,
): ScoredResult {
  if (bestScore.matchType !== "strong" && bestScore.matchType !== "exact") return bestScore;
  if (queryAsksForGoods) return bestScore;

  const lower = officialName.toLowerCase();
  if (!GOODS_CONTEXT_MARKERS.test(lower)) return bestScore;

  const domainHits = [intent.primaryNoun, ...intent.requiredTerms]
    .filter((t) => t.length > 2)
    .some((t) => lower.includes(t.toLowerCase()));
  if (!domainHits) return bestScore;

  return {
    activityId: bestScore.activityId,
    matchType: "related",
    score: Math.min(bestScore.score, 0.72),
    reasons: [
      `Matches "${intent.primaryNoun}" domain, but this activity is goods/equipment trading — related, not the business operation itself.`,
    ],
  };
}

async function runPipeline(
  options: SearchOptions,
  opts: { includeAvailability?: boolean } = {}
): Promise<PipelineOutput> {
  const { q } = options;
  const includeAvailability = opts.includeAvailability ?? false;

  const parsed = parseQuery(q);
  const intent = detectBusinessIntent(parsed.businessPhrase);
  const keywords = extractKeywords(parsed.businessPhrase);

  if (parsed.businessTerms.length === 0 && !/\d/.test(q)) {
    const availability = includeAvailability
      ? (await fetchCandidates(q, intent, keywords, true)).availability
      : [];
    return { items: [], intent, parsed, candidatesEvaluated: 0, availability };
  }

  const { rows, evaluated, availability } = await fetchCandidates(
    q,
    intent,
    keywords,
    includeAvailability
  );

  const queryAsksForGoods = GOODS_CONTEXT_MARKERS.test(parsed.businessPhrase);

  const candidatesMap = new Map<string, { row: CandidateRow; bestScore: ScoredResult }>();

  for (const row of rows) {
    const id = row.activity.id;
    let scored = scoreActivity(intent, keywords, {
      id: row.activity.id,
      officialName: row.activity.officialName,
      normalizedName: row.activity.normalizedName,
      activityCode: row.activity.activityCode,
      isicCode: row.activity.isicCode,
      description: row.activity.description,
      officialCategory: row.activity.officialCategory,
      activityGroup: row.activity.activityGroup,
    }, q);
    if (!scored) continue;

    scored = capGoodsContextMatch(row.activity.officialName, intent, scored, queryAsksForGoods);

    const existing = candidatesMap.get(id);
    if (!existing || scored.score > existing.bestScore.score) {
      candidatesMap.set(id, { row, bestScore: scored });
    }
  }

  const items: SearchResultItem[] = [];

  for (const { row, bestScore } of candidatesMap.values()) {
    if (bestScore.score < MIN_RELEVANCE) continue;

    // A jurisdiction mentioned in the query (e.g. "restaurant in RAKEZ")
    // filters the result set to that jurisdiction. Otherwise all indexed
    // jurisdictions are searched.
    if (parsed.jurisdictionSlug && row.jurisdiction.slug !== parsed.jurisdictionSlug) continue;

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
        isicCode: row.activity.isicCode,
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

  return { items, intent, parsed, candidatesEvaluated: evaluated, availability };
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
 *
 * STEP 6.1: the whole response costs exactly ONE database round trip — the
 * availability query is folded into the candidate UNION as an extra branch.
 */
export async function searchUnified(options: SearchOptions): Promise<UnifiedSearchResponse> {
  const startedAt = Date.now();
  const { limit = 20, offset = 0, groupLimit = 8, allMatches = false } = options;

  const pipeline = await runPipeline(options, { includeAvailability: true });

  const { items, intent, parsed, candidatesEvaluated, availability: allJurisdictions } = pipeline;

  // Grouped-analysis callers (jurisdiction comparison, jurisdiction intelligence)
  // summarise the best match per jurisdiction across EVERY match rather than
  // walking a page at a time, so they opt out of paging. Slicing is free here —
  // the pipeline has already materialised the full ranked list.
  const effectiveOffset = allMatches ? 0 : offset;
  const effectiveLimit = allMatches ? items.length : limit;

  // Flat page — THE slice this request is about.
  const results = items.slice(effectiveOffset, effectiveOffset + effectiveLimit);

  // Groups are built in two deliberate passes:
  //
  //  1. counts and best-match type run over EVERY match, so `totalMatches` and
  //     `bestMatchType` stay truthful and the group ordering is identical on
  //     every page;
  //  2. `topResults` is filled from the PAGE only, so a group renders exactly
  //     the slice that was requested.
  //
  // Both used to be filled from every match, which made `offset`/`limit` a no-op
  // for the grouped view: page 2 rendered the same top hits as page 1 while the
  // pager advertised the full match count.
  const bestByJurisdiction = new Map<string, { type: MatchType; score: number }>();
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
      bestByJurisdiction.set(item.jurisdiction.id, {
        type: item.matchType,
        score: item.matchScore,
      });
    }
    group.totalMatches += 1;

    const incumbent = bestByJurisdiction.get(item.jurisdiction.id)!;
    if (
      TYPE_PRIORITY[item.matchType] < TYPE_PRIORITY[incumbent.type] ||
      (TYPE_PRIORITY[item.matchType] === TYPE_PRIORITY[incumbent.type] &&
        item.matchScore > incumbent.score)
    ) {
      bestByJurisdiction.set(item.jurisdiction.id, {
        type: item.matchType,
        score: item.matchScore,
      });
      group.bestMatchType = item.matchType;
    }
  }

  // Second pass: `topResults` is the rendered slice, taken from the page only.
  for (const item of results) {
    const group = grouped.get(item.jurisdiction.id);
    // `results` is a slice of `items`, so the group always exists here. Guarded
    // anyway: a missing group must never silently drop a result from the page.
    if (!group) continue;
    if (group.topResults.length < groupLimit) {
      group.topResults.push(item);
    }
  }

  // Every jurisdiction whose official activity data is actually imported must
  // report availability explicitly. Registry placeholder rows without any
  // imported activity are excluded. (Rows fetched concurrently with the
  // candidate UNION above; never re-query.)
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
      searchIntents: parsed.searchIntents,
      jurisdictionSlug: parsed.jurisdictionSlug,
      jurisdictionName: parsed.jurisdictionName,
      businessTerms: parsed.businessTerms,
      typoCorrected: parsed.correctedQuery !== parsed.originalQuery,
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
