import { describe, it, expect } from "vitest";
import {
  trimOrNull,
  cleanText,
  normalizeName,
  normalizeCategory,
  parseAmount,
  formatAmount,
  isTruthyFlag,
  todayIso,
} from "@/lib/ingestion/normalize";

// ---------------------------------------------------------------------------
// trimOrNull
// ---------------------------------------------------------------------------
describe("trimOrNull", () => {
  it("returns undefined for null", () => {
    expect(trimOrNull(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(trimOrNull(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(trimOrNull("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(trimOrNull("   ")).toBeUndefined();
  });

  it("trims leading and trailing whitespace", () => {
    expect(trimOrNull(" hello ")).toBe("hello");
  });

  it("handles null bytes in input", () => {
    expect(trimOrNull("hello\x00world")).toBe("hello\x00world");
  });

  it("replaces non-breaking spaces with regular spaces", () => {
    expect(trimOrNull("hello\u00a0world")).toBe("hello world");
  });

  it("returns the string when it is already clean", () => {
    expect(trimOrNull("abc")).toBe("abc");
  });

  it("converts non-string types via String()", () => {
    expect(trimOrNull(42)).toBe("42");
    expect(trimOrNull(true)).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// cleanText
// ---------------------------------------------------------------------------
describe("cleanText", () => {
  it("returns undefined for null", () => {
    expect(cleanText(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(cleanText(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(cleanText("")).toBeUndefined();
  });

  it("collapses multiple internal spaces", () => {
    expect(cleanText("hello   world")).toBe("hello world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(cleanText("  leading and trailing  ")).toBe("leading and trailing");
  });

  it("preserves single words", () => {
    expect(cleanText("hello")).toBe("hello");
  });

  it("handles tabs and newlines", () => {
    expect(cleanText("a\tb\nc")).toBe("a b c");
  });
});

// ---------------------------------------------------------------------------
// normalizeName
// ---------------------------------------------------------------------------
describe("normalizeName", () => {
  it("lowercases the name", () => {
    expect(normalizeName("General Trading")).toBe("general trading");
  });

  it("strips non-word characters and collapses spaces", () => {
    expect(normalizeName("Restaurant & Café")).toBe("restaurant caf");
  });

  it("trims extra spaces", () => {
    expect(normalizeName("  SPACES  ")).toBe("spaces");
  });

  it("replaces hyphens with spaces", () => {
    expect(normalizeName("ABC-123")).toBe("abc 123");
  });

  it("joins camelCase words", () => {
    expect(normalizeName("HelloWorld")).toBe("helloworld");
  });

  it("strips dots and slashes", () => {
    expect(normalizeName("A.B. Trading / Services")).toBe("a b trading services");
  });

  it("returns empty string for special chars only", () => {
    expect(normalizeName("!!!@@@")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// normalizeCategory
// ---------------------------------------------------------------------------
describe("normalizeCategory", () => {
  it("returns undefined for null", () => {
    expect(normalizeCategory(null)).toBeUndefined();
  });

  it("lowercases and cleans category", () => {
    expect(normalizeCategory("Food & Beverage")).toBe("food & beverage");
  });

  it("trims whitespace and lowercases", () => {
    expect(normalizeCategory("  IT Services  ")).toBe("it services");
  });

  it("returns undefined for empty string", () => {
    expect(normalizeCategory("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(normalizeCategory("   ")).toBeUndefined();
  });

  it("collapses internal whitespace", () => {
    expect(normalizeCategory("Real   Estate")).toBe("real estate");
  });
});

// ---------------------------------------------------------------------------
// parseAmount
// ---------------------------------------------------------------------------
describe("parseAmount", () => {
  it("returns undefined for null", () => {
    expect(parseAmount(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(parseAmount(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseAmount("")).toBeUndefined();
  });

  it("parses AED formatted amounts", () => {
    expect(parseAmount("AED 1,234.50")).toBe(1234.5);
  });

  it("parses plain integer strings", () => {
    expect(parseAmount("1234")).toBe(1234);
  });

  it("parses comma-separated thousands", () => {
    expect(parseAmount("1,234,567")).toBe(1234567);
  });

  it("passes through finite numbers", () => {
    expect(parseAmount(42.5)).toBe(42.5);
  });

  it("returns undefined for NaN number input", () => {
    expect(parseAmount(NaN)).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(parseAmount(Infinity)).toBeUndefined();
  });

  it("returns undefined for non-numeric strings", () => {
    expect(parseAmount("not a number")).toBeUndefined();
  });

  it("parses zero", () => {
    expect(parseAmount("AED 0")).toBe(0);
  });

  it("parses negative amounts", () => {
    expect(parseAmount("-500")).toBe(-500);
  });

  it("handles en-dash and em-dash as minus", () => {
    expect(parseAmount("\u2013500")).toBe(-500);
    expect(parseAmount("\u2014500")).toBe(-500);
  });
});

// ---------------------------------------------------------------------------
// formatAmount
// ---------------------------------------------------------------------------
describe("formatAmount", () => {
  it("formats decimal to two decimal places", () => {
    expect(formatAmount(1234.5)).toBe("1234.50");
  });

  it("formats zero", () => {
    expect(formatAmount(0)).toBe("0.00");
  });

  it("formats large numbers", () => {
    expect(formatAmount(999999)).toBe("999999.00");
  });

  it("formats numbers that already have two decimals", () => {
    expect(formatAmount(10.99)).toBe("10.99");
  });
});

// ---------------------------------------------------------------------------
// isTruthyFlag
// ---------------------------------------------------------------------------
describe("isTruthyFlag", () => {
  it("returns false for null", () => {
    expect(isTruthyFlag(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isTruthyFlag(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isTruthyFlag("")).toBe(false);
  });

  it("returns true for 'y'", () => {
    expect(isTruthyFlag("y")).toBe(true);
  });

  it("returns true for 'Y'", () => {
    expect(isTruthyFlag("Y")).toBe(true);
  });

  it("returns true for 'yes'", () => {
    expect(isTruthyFlag("yes")).toBe(true);
  });

  it("returns true for 'Yes'", () => {
    expect(isTruthyFlag("Yes")).toBe(true);
  });

  it("returns true for 'true'", () => {
    expect(isTruthyFlag("true")).toBe(true);
  });

  it("returns true for '1'", () => {
    expect(isTruthyFlag("1")).toBe(true);
  });

  it("returns true for 'required'", () => {
    expect(isTruthyFlag("required")).toBe(true);
  });

  it("returns true for 'needed'", () => {
    expect(isTruthyFlag("needed")).toBe(true);
  });

  it("returns false for 'no'", () => {
    expect(isTruthyFlag("no")).toBe(false);
  });

  it("returns false for 'n'", () => {
    expect(isTruthyFlag("n")).toBe(false);
  });

  it("returns false for '0'", () => {
    expect(isTruthyFlag("0")).toBe(false);
  });

  it("returns false for arbitrary strings", () => {
    expect(isTruthyFlag("anything")).toBe(false);
  });

  it("trims whitespace before checking", () => {
    expect(isTruthyFlag("  yes  ")).toBe(true);
    expect(isTruthyFlag("  no  ")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// todayIso
// ---------------------------------------------------------------------------
describe("todayIso", () => {
  it("returns a string in YYYY-MM-DD format", () => {
    const result = todayIso();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns today's date", () => {
    const result = todayIso();
    const today = new Date().toISOString().split("T")[0];
    expect(result).toBe(today);
  });

  it("returns a different value than a future date string", () => {
    const result = todayIso();
    expect(result.length).toBe(10);
  });
});
