/**
 * Shared presentation helpers for the public site.
 * Server-safe: no client-only APIs.
 */

export function formatEmirate(emirate: string | null | undefined): string {
  if (!emirate) return "—";
  return emirate.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function formatJurisdictionType(type: string | null | undefined): string {
  switch (type) {
    case "free_zone":
      return "Free Zone";
    case "mainland":
      return "Mainland";
    default:
      return type ? type.replace(/_/g, " ") : "—";
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-AE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatAed(amount: number | string | null | undefined): string | null {
  if (amount === null || amount === undefined) return null;
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return null;
  return `AED ${n.toLocaleString()}`;
}

export function titleCaseEnum(value: string): string {
  return value.replace(/_/g, " ");
}
