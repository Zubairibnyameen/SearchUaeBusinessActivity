/**
 * Shared normalization helpers.
 * Rules: never silently alter official values — official strings are kept
 * verbatim in official* fields; normalized derivatives live in separate fields.
 */

const WHITESPACE = /\s+/g;

export function trimOrNull(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).replace(/\u00a0/g, " ").trim();
  return s.length > 0 ? s : undefined;
}

/** Collapse whitespace, standardize unicode punctuation spacing. */
export function cleanText(value: unknown): string | undefined {
  const s = trimOrNull(value);
  if (!s) return undefined;
  return s.replace(WHITESPACE, " ");
}

/**
 * Search-normalized name: lowercase, strip non-word chars, collapse spaces.
 * Matches the convention used by the DMCC import and the search engine.
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

export function normalizeCategory(value: unknown): string | undefined {
  const s = cleanText(value);
  return s ? s.toLowerCase().replace(WHITESPACE, " ") : undefined;
}

/** Parse "AED 1,234.50", "1234", 1234.00 → number; undefined when unparseable. */
export function parseAmount(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const cleaned = String(value)
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^0-9.,\-]/g, "")
    .replace(/,(?=\d{3}\b)/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && cleaned !== "" ? n : undefined;
}

export function formatAmount(n: number): string {
  return n.toFixed(2);
}

/** Detect obvious yes-style flags across sources ("Y", "Yes", "true", 1, "Required"). */
export function isTruthyFlag(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const s = String(value).trim().toLowerCase();
  return ["y", "yes", "true", "1", "required", "needed"].includes(s);
}

export function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}
