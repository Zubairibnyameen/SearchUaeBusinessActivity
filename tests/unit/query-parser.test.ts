import { describe, it, expect } from "vitest";
import {
  parseQuery,
  extractJurisdiction,
  classifySearchIntent,
  correctKnownTypo,
  correctQueryTypos,
  extractContentWords,
} from "@/lib/search/query-parser";

describe("query-parser: jurisdiction extraction", () => {
  it("hits every indexed jurisdiction", () => {
    expect(extractJurisdiction("restaurant in RAKEZ").slug).toBe("rakez");
    expect(extractJurisdiction("cafe in SPC Free Zone").slug).toBe("spc");
    expect(extractJurisdiction("trading in Ajman Free Zone").slug).toBe("afz");
    expect(extractJurisdiction("clinic in DMCC").slug).toBe("dmcc");
    expect(extractJurisdiction("brokerage at IFZA").slug).toBe("ifza");
  });

  it("resolves aliases", () => {
    expect(extractJurisdiction("restaurant in Ras Al Khaimah").slug).toBe("rakez");
    expect(extractJurisdiction("dubai multi commodities centre trading").slug).toBe("dmcc");
    expect(extractJurisdiction("international free zone authority permit").slug).toBe("ifza");
    expect(extractJurisdiction("sharjah publishing city logistics").slug).toBe("spc");
    expect(extractJurisdiction("ajman free zone cafe").slug).toBe("afz");
  });

  it("strips the jurisdiction token from the cleaned query", () => {
    const { cleanedQuery } = extractJurisdiction("restaurant in RAKEZ");
    expect(cleanedQuery.toLowerCase()).not.toContain("rakez");
  });

  it("returns null slug when no jurisdiction is mentioned", () => {
    expect(extractJurisdiction("restaurant equipment").slug).toBeNull();
  });

  it("strips ALL mentioned zones in a comparison query", () => {
    const { slug, cleanedQuery } = extractJurisdiction("compare RAKEZ and DMCC restaurant");
    expect(slug).toBe("rakez");
    expect(cleanedQuery.toLowerCase()).not.toContain("dmcc");
    expect(cleanedQuery.toLowerCase()).not.toContain("rakez");
  });
});

describe("query-parser: intent classification", () => {
  it("classifies a licence search", () => {
    const intents = classifySearchIntent("how do I get a licence for a restaurant", null);
    expect(intents).toContain("LICENCE_SEARCH");
    expect(intents).toContain("ACTIVITY_SEARCH");
  });

  it("classifies an approval search", () => {
    const intents = classifySearchIntent("do I need an approval to open a restaurant", null);
    expect(intents).toContain("APPROVAL_SEARCH");
  });

  it("classifies a fee search", () => {
    const intents = classifySearchIntent("how much does a restaurant licence cost", null);
    expect(intents).toContain("FEE_SEARCH");
  });

  it("classifies a comparison intent", () => {
    const intents = classifySearchIntent("compare RAKEZ vs DMCC", "rakez");
    expect(intents).toContain("COMPARISON_INTENT");
  });

  it("classifies a jurisdiction browse", () => {
    const intents = classifySearchIntent("what activities are available in DMCC", "dmcc");
    expect(intents).toContain("JURISDICTION_SEARCH");
  });

  it("always includes an activity search intent", () => {
    const intents = classifySearchIntent("restaurant", null);
    expect(intents).toEqual(["ACTIVITY_SEARCH"]);
  });
});

describe("query-parser: typo correction", () => {
  it("corrects curated typos", () => {
    const cases: Record<string, string> = {
      jewlery: "jewellery",
      restarant: "restaurant",
      resturant: "restaurant",
      accountng: "accounting",
      acconting: "accounting",
      logistcs: "logistics",
      logostics: "logistics",
      medcial: "medical",
      medicle: "medical",
      clininc: "clinic",
      marketng: "marketing",
      advertisng: "advertising",
      electroncs: "electronics",
      sotware: "software",
      phamacy: "pharmacy",
      warehousng: "warehousing",
      petrolium: "petroleum",
      mangement: "management",
      buisness: "business",
      busines: "business",
      delevering: "delivering",
      trainng: "training",
      institude: "institute",
      institue: "institute",
    };
    for (const [input, expected] of Object.entries(cases)) {
      expect(correctKnownTypo(input)).toBe(expected);
    }
  });

  it("leaves valid business words untouched", () => {
    for (const word of [
      "general", "trading", "training", "dental", "retail", "consulting",
      "consultancy", "clinic", "business", "company", "store", "shop",
      "restaurant", "accounting", "logistics", "food", "property", "rental",
    ]) {
      expect(correctKnownTypo(word)).toBe(word);
    }
  });

  it("corrects typos across a whole query but keeps the rest intact", () => {
    expect(correctQueryTypos("jewlery trading company in DMCC")).toBe("jewellery trading company in DMCC");
    expect(correctQueryTypos("i want a restarant")).toBe("i want a restaurant");
  });

  it("does not invent corrections for nonsense words", () => {
    expect(correctKnownTypo("zzzzqq")).toBe("zzzzqq");
  });
});

describe("query-parser: parseQuery", () => {
  it("parses a plain activity query", () => {
    const p = parseQuery("restaurant");
    expect(p.businessPhrase).toBe("restaurant");
    expect(p.businessTerms).toEqual(["restaurant"]);
    expect(p.jurisdictionSlug).toBeNull();
    expect(p.searchIntents).toEqual(["ACTIVITY_SEARCH"]);
  });

  it("parses a jurisdiction-scoped query", () => {
    const p = parseQuery("restaurant in RAKEZ");
    expect(p.jurisdictionSlug).toBe("rakez");
    expect(p.jurisdictionName).toBe("RAKEZ");
    expect(p.businessTerms).toEqual(["restaurant"]);
  });

  it("parses a typo query and flags it", () => {
    const p = parseQuery("jewlery trading");
    expect(p.correctedQuery).toBe("jewellery trading");
    expect(p.businessTerms).toEqual(["jewellery", "trading"]);
    expect(p.correctedQuery !== p.originalQuery).toBe(true);
  });

  it("reports correction status through parsed fields", () => {
    const p = parseQuery("restarant in DMCC");
    expect(p.jurisdictionSlug).toBe("dmcc");
    expect(p.businessPhrase).toBe("restaurant");
  });

  it("drops filler and intent-only words", () => {
    const p = parseQuery("i want to start a restaurant");
    expect(p.businessTerms).toEqual(["restaurant"]);
  });

  it("keeps business terms for natural language phrasing", () => {
    const p = parseQuery("looking to open a clothing store");
    expect(p.businessTerms).toEqual(["clothing", "store"]);
  });

  it("returns empty business terms for intent-only queries", () => {
    const p = parseQuery("how much does this approval cost");
    expect(p.businessTerms).toEqual([]);
    expect(p.searchIntents).toContain("FEE_SEARCH");
    expect(p.searchIntents).toContain("APPROVAL_SEARCH");
  });
});

describe("query-parser: content word extraction", () => {
  it("keeps multi-token business phrases", () => {
    expect(extractContentWords("online clothing store")).toEqual(["online", "clothing", "store"]);
  });

  it("strips punctuation", () => {
    expect(extractContentWords("restaurant!")).toEqual(["restaurant"]);
  });
});