/**
 * Deterministic query-understanding layer for UAE business activity search.
 *
 * This module is PURE and side-effect free. It:
 *  1. Applies conservative, high-confidence typo correction (curated map +
 *     a guarded Damerau–Levenshtein scan over a fixed business vocabulary).
 *  2. Detects an indexed jurisdiction mentioned in the query and strips the
 *     token(s) so they are never treated as activity terms.
 *  3. Classifies the general search intent (activity / jurisdiction / licence /
 *     approval / fee / comparison).
 *  4. Produces the cleaned business terms that feed the matching engine.
 *
 * Nothing here invents official activity names or regulatory facts.
 */

import type { SearchIntent } from "./types";

// ============================================================
// 1. INDEXED JURISDICTIONS
// ============================================================

export type JurisdictionAlias = { slug: string; name: string; aliases: string[] };

/**
 * The five regulatory jurisdictions whose official activity data is actually
 * imported. Mapping is static and deterministic: a jurisdiction name in a
 * query is never treated as part of the business activity.
 */
export const INDEXED_JURISDICTIONS: JurisdictionAlias[] = [
  {
    slug: "rakez",
    name: "RAKEZ",
    aliases: ["rakez", "rak free zone", "ras al khaimah economic zone", "ras al khaimah"],
  },
  {
    slug: "spc",
    name: "SPC Free Zone",
    aliases: ["spc free zone", "spc", "sharjah publishing city", "sharjah publishing city free zone"],
  },
  {
    slug: "afz",
    name: "Ajman Free Zone",
    aliases: ["ajman free zone", "ajman"],
  },
  {
    slug: "dmcc",
    name: "DMCC",
    aliases: ["dmcc", "dubai multi commodities centre", "dubai multi commodities center", "dubai multi commodity"],
  },
  {
    slug: "ifza",
    name: "IFZA",
    aliases: ["ifza", "international free zone authority"],
  },
];

const JURISDICTION_PATTERNS: { slug: string; name: string; re: RegExp; alias: string }[] =
  INDEXED_JURISDICTIONS.flatMap((j) =>
    j.aliases.map((alias) => {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return { slug: j.slug, name: j.name, re: new RegExp(`\\b${escaped}\\b`, "i"), alias };
    }),
  ).sort((a, b) => b.alias.length - a.alias.length);

/**
 * Detect an indexed jurisdiction in a query. Returns the slug, the display
 * name, and the cleaned query with the jurisdiction phrase removed.
 */
export function extractJurisdiction(query: string): {
  slug: string | null;
  name: string | null;
  cleanedQuery: string;
  matchedPhrase: string | null;
} {
  let cleaned = query;
  let found: { slug: string; name: string; alias: string } | null = null;

  for (const p of JURISDICTION_PATTERNS) {
    if (!found && p.re.test(cleaned)) {
      found = { slug: p.slug, name: p.name, alias: p.alias };
    }
    // Remove every matched jurisdiction's aliases so a comparison query like
    // "RAKEZ vs DMCC" never leaks a second zone name into the business terms.
    // The FIRST match stays the primary filter.
    if (p.re.test(cleaned)) {
      cleaned = cleaned.replace(p.re, " ");
    }
  }

  // Collapse doubled spaces left by removed phrases.
  const collapsed = cleaned.replace(/\s{2,}/g, " ").trim();
  return {
    slug: found?.slug ?? null,
    name: found?.name ?? null,
    cleanedQuery: collapsed,
    matchedPhrase: found?.alias ?? null,
  };
}

// ============================================================
// 2. SEARCH INTENT CLASSIFICATION
// ============================================================

const INTENT_MARKERS: { type: SearchIntent; patterns: RegExp[]; words: string[] }[] = [
  {
    type: "COMPARISON_INTENT",
    patterns: [/\bcompare\b/i, /\bversus\b/i, /\bvs\.?\s/i, /\bdifference between\b/i, /\bwhich is better\b/i],
    words: [],
  },
  {
    type: "JURISDICTION_SEARCH",
    patterns: [/\bactivities?\s+(?:that\s+)?(?:are|is)\s+available\s+in\b/i, /\bwhat\s+activities?\b/i, /\bwhat\s+business(?:es)?\s+can\b/i, /\bavailable\s+in\b/i, /\bwhat\s+can\s+i\s+do\s+in\b/i],
    words: ["activities", "available"],
  },
  {
    type: "LICENCE_SEARCH",
    patterns: [/\blicen[cs]e(d|s)?\b/i, /\bpermit(?:s)?\b/i, /\bto\s+operate\b/i],
    words: ["licence", "license", "licences", "licenses", "permit"],
  },
  {
    type: "APPROVAL_SEARCH",
    patterns: [/\bapproval(s)?\b/i, /\bpermission\b/i, /\bregulatory\b/i, /\bdo\s+i\s+need\b/i],
    words: ["approval", "permission", "regulatory"],
  },
  {
    type: "FEE_SEARCH",
    patterns: [/\bfees?\b/i, /\bcosts?\b/i, /\bhow\s+much\b/i, /\bprices?\b/i, /\bcharges?\b/i],
    words: ["fee", "fees", "cost", "costs", "price", "prices", "charge", "charges"],
  },
];

/** Words that carry intent meaning but must never be treated as activity terms. */
const INTENT_ONLY_WORDS = new Set<string>(
  ([] as string[]).concat(
    ...INTENT_MARKERS.map((m) => m.words),
    "how", "much", "many", "does", "did", "this", "that", "these", "those",
    "what", "which", "when", "where", "who", "why", "please", "any", "all",
    "need", "required", "obtain", "get", "want", "start", "open", "run",
  ),
);

/**
 * Classify the overall search intent. Multiple signals may fire (e.g. an
 * activity + approval query); the array is ordered by strength.
 */
export function classifySearchIntent(query: string, jurisdictionSlug: string | null): SearchIntent[] {
  const hits: { type: SearchIntent; score: number }[] = [];
  const q = query.toLowerCase();

  for (const marker of INTENT_MARKERS) {
    let score = 0;
    if (marker.patterns.some((re) => re.test(q))) score += 2;
    for (const w of marker.words) {
      if (new RegExp(`\\b${w}\\b`).test(q)) score += 1;
    }
    if (score > 0) hits.push({ type: marker.type, score });
  }

  // A jurisdiction mentioned without any concrete business activity word but
  // with an exploratory phrase is a jurisdiction browse.
  const hasJurisdictionPhrase = /\bavailable in\b/i.test(q) || /\bwhat\s+activities?\b/i.test(q);
  if (jurisdictionSlug && hasJurisdictionPhrase && !hits.some((h) => h.type === "JURISDICTION_SEARCH")) {
    hits.push({ type: "JURISDICTION_SEARCH", score: 1 });
  }

  if (!hits.some((h) => h.type === "ACTIVITY_SEARCH")) {
    hits.push({ type: "ACTIVITY_SEARCH", score: 0 });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.map((h) => h.type);
}

// ============================================================
// 3. TYPO CORRECTION (high confidence only)
// ============================================================

/** Curated map of the most common, unambiguous misspellings. */
const CURATED_TYPO_MAP: Record<string, string> = {
  jewlery: "jewellery",
  jewelery: "jewellery",
  jewellry: "jewellery",
  restarant: "restaurant",
  resturant: "restaurant",
  restarunt: "restaurant",
  accountng: "accounting",
  acconting: "accounting",
  accoutning: "accounting",
  logistcs: "logistics",
  logostics: "logistics",
  medcial: "medical",
  medicle: "medical",
  clininc: "clinic",
  marketng: "marketing",
  advertisng: "advertising",
  electroncs: "electronics",
  elecronics: "electronics",
  sotware: "software",
  phamacy: "pharmacy",
  furnitur: "furniture",
  warehousng: "warehousing",
  petrolium: "petroleum",
  mangement: "management",
  buisness: "business",
  busines: "business",
  recieving: "receiving",
  delevering: "delivering",
  trainng: "training",
  institude: "institute",
  institue: "institute",
};

/**
 * Vocabulary used for the guarded Levenshtein pass. Only these high-signal
 * business terms can be produced by fuzzy correction, which keeps false
 * corrections out of the results.
 */
const FUZZY_VOCABULARY = new Set([
  "jewellery", "restaurant", "accounting", "logistics", "medical", "clinic",
  "marketing", "advertising", "electronics", "software", "development",
  "pharmacy", "furniture", "warehousing", "petroleum", "management",
  "business", "training", "institute", "transport", "transportation",
  "hospitality", "construction", "engineering", "consultancy", "brokerage",
  "security", "cleaning", "recruitment", "translation", "photography",
  "insurance", "carpentry", "electrical", "wholesale", "retail", "coffee",
  "bakery", "catering", "tailoring", "marble", "steel", "printing",
  "packaging", "travel", "tourism", "shipping", "freight", "storage",
]);

/** Damerau–Levenshtein distance (allows transpositions). */
function damerauLevenshtein(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  if (aLen > bLen) [a, b] = [b, a]; // symmetrical; keep smaller on rows

  const aLen2 = a.length;
  const bLen2 = b.length;
  const maxDist = aLen2 + bLen2;
  const matrix: number[][] = [];

  for (let i = 0; i <= aLen2 + 1; i++) {
    matrix[i] = new Array(bLen2 + 2).fill(maxDist);
    matrix[i][0] = i - 1;
  }
  for (let j = 0; j <= bLen2 + 1; j++) matrix[0][j] = j - 1;

  for (let i = 1; i <= aLen2; i++) {
    for (let j = 1; j <= bLen2; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
      }
    }
  }
  return matrix[aLen2][bLen2];
}

/**
 * Common, valid business words that must never be rewritten by the fuzzy pass
 * even if they sit within one edit of a vocabulary term (e.g. "trading" vs
 * "training", "dental" vs "retail"). The curated map still applies first.
 */
const PROTECTED_WORDS = new Set([
  "general", "trading", "training", "dental", "retail", "retails",
  "consulting", "consultancy", "consultant", "consultants", "clinic",
  "clinics", "medical", "business", "businesses", "company", "companies",
  "services", "service", "agency", "agencies", "firm", "firms", "group",
  "groups", "store", "stores", "shop", "shops", "outlet", "outlets",
  "marketplace", "online", "digital", "internet", "ecommerce", "website",
  "property", "estate", "rental", "rentals", "brokerage", "broker", "brokers",
  "food", "foodstuff", "restaurant", "restaurants", "coffee", "cafe", "cafes",
  "catering", "bakery", "kitchen", "wholesale", "import", "export", "exports",
  "imports", "supply", "supplier", "suppliers", "distribution", "logistics",
  "transport", "transportation", "freight", "shipping", "cargo", "warehouse",
  "warehousing", "storage", "courier", "couriers", "delivery", "deliveries",
  "accounting", "accountancy", "bookkeeping", "audit", "auditing", "finance",
  "financial", "tax", "taxation", "legal", "law", "lawyer", "lawyers",
  "marketing", "advertising", "social", "media", "publication", "publications",
  "software", "technology", "technologies", "development", "programming",
  "developer", "developers", "design", "designing", "designer", "designers",
  "interior", "decoration", "engineering", "engineer", "engineers",
  "construction", "contracting", "maintenance", "repair", "cleaning",
  "security", "safety", "protection", "guarding", "health", "healthcare",
  "pharmacy", "pharmacies", "laboratory", "lab", "school", "schools",
  "education", "academy", "training", "courses", "teaching", "photography",
  "translation", "interpretation", "recruitment", "staffing", "employment",
  "hospitality", "tourism", "travel", "hotel", "hotels", "insurance",
  "banking", "investment", "investments", "crypto", "currency", "exchange",
  "telecom", "telecommunications", "electronics", "electrical", "electronic",
  "furniture", "furnishings", "textile", "textiles", "garment", "garments",
  "apparel", "fashion", "clothes", "clothing", "jewellery", "jewelry",
  "gems", "diamond", "diamonds", "jewel", "jewels", "petrol", "petroleum",
  "gas", "oil", "chemical", "chemicals", "agriculture", "agri", "farm",
  "farming", "printing", "publishing", "packaging", "plastic", "plastics",
  "marble", "steel", "timber", "wood", "glass", "ceramic", "event", "events",
  "wedding", "conference", "conferences", "training", "fitness", "gym",
  "sports", "recreation", "automotive", "automobile", "automobiles",
  "vehicles", "cars", "spare", "parts", "equipment", "machinery", "machines",
  "tools", "appliances", "electronics", "mobile", "phones", "fashion",
  "beauty", "salon", "barber", "barbershop", "nursery", "landscaping",
  "greenhouse", "aviation", "aviation", "maritime", "marine", "offshore",
  "cargo", "vessel", "vessels", "advisory", "strategy", "consultancy",
  "broking", "valuation", "surveying", "representation", "supervision",
  "project", "management", "operations", "operations", "hr", "human",
  "resources", "charity", "foundation", "nonprofit", "ngo", "gaming",
  "gaming", "esports", "entertainment", "media", "production", "film",
  "music", "art", "arts", "artistic", "renewable", "solar", "energy",
]);

/**
 * Correct a misspelled word. Rules are deliberately conservative:
 *  - curated map wins (always applied),
 *  - common valid words are never rewritten,
 *  - otherwise a vocabulary word within a SINGLE edit (or, for hand-picked
 *    high-signal terms, two) is used only when it is the unique close
 *    candidate and the current word is not itself a known vocabulary word.
 */
export function correctKnownTypo(word: string): string {
  const lower = word.toLowerCase().trim();
  if (lower.length < 3) return word;

  const curated = CURATED_TYPO_MAP[lower];
  if (curated) return curated;

  if (PROTECTED_WORDS.has(lower)) return word;

  if (lower.length < 5 || FUZZY_VOCABULARY.has(lower)) return word;

  let best: { term: string; dist: number } | null = null;
  for (const term of FUZZY_VOCABULARY) {
    const dist = damerauLevenshtein(lower, term);
    if (dist <= 1) {
      if (!best || dist < best.dist) best = { term, dist };
      else if (dist === best.dist && best.term !== term) return word; // tie → ambiguous
    }
  }
  return best ? best.term : word;
}

/** Correct typos across the whole query, preserving original casing/tokens. */
export function correctQueryTypos(query: string): string {
  const tokens = query.match(/[A-Za-z]+|\d+|[^\w\s]|\s+/g) ?? [];
  let out = "";
  for (const tok of tokens) {
    if (/^[A-Za-z]+$/.test(tok)) {
      out += correctKnownTypo(tok);
    } else {
      out += tok;
    }
  }
  return out;
}

// ============================================================
// 4. STOP WORDS / FILLER
// ============================================================

const CONVERSATIONAL_FILLER = new Set([
  "i", "want", "to", "start", "a", "an", "the", "my", "our",
  "in", "from", "and", "or", "with", "for", "of", "is", "are",
  "be", "do", "can", "will", "would", "should", "could", "need",
  "like", "looking", "open", "set", "up", "run", "buying",
  "am", "planning", "thinking", "interested", "starting", "opening",
  "how", "what", "which", "when", "where", "who", "why", "much",
  "many", "does", "did", "get", "it", "this", "that", "these",
  "those", "there", "here", "then", "than", "about", "over",
  "under", "at", "by", "also", "just", "really", "please", "me",
  "one", "any", "all", "some", "help",
]);

/** Extract content words from a cleaned query (filler excluded). */
export function extractContentWords(query: string): string[] {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !CONVERSATIONAL_FILLER.has(w) && !INTENT_ONLY_WORDS.has(w));
}

// ============================================================
// 5. PARSED QUERY
// ============================================================

export interface ParsedQuery {
  originalQuery: string;
  correctedQuery: string;
  jurisdictionSlug: string | null;
  jurisdictionName: string | null;
  searchIntents: SearchIntent[];
  /** Business content words that drive activity matching (typos corrected). */
  businessTerms: string[];
  /** Human-readable phrase built from business terms (e.g. "online clothing store"). */
  businessPhrase: string;
}

export function parseQuery(query: string): ParsedQuery {
  const corrected = correctQueryTypos(query.trim());

  const { slug, name, cleanedQuery } = extractJurisdiction(corrected);

  const searchIntents = classifySearchIntent(corrected, slug);

  const businessTerms = extractContentWords(cleanedQuery);

  return {
    originalQuery: query.trim(),
    correctedQuery: corrected,
    jurisdictionSlug: slug,
    jurisdictionName: name,
    searchIntents,
    businessTerms,
    businessPhrase: businessTerms.join(" "),
  };
}