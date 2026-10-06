/**
 * Jurisdiction-aware primary identifier for an activity.
 *
 * The same activity record carries two identifiers and they are NOT
 * interchangeable:
 *
 *   - `isicCode`     the published ISIC Rev.4 classification.
 *   - `activityCode` the jurisdiction's own catalogue code, surfaced to the
 *                    public as the "License Number" for non-AFZ jurisdictions.
 *
 * Per product rule:
 *   - AJMAN FREE ZONE (jurisdiction slug `afz`) → the primary identifier is the
 *     ISIC Code. The activity code / license number must NOT appear as the
 *     primary identifier.
 *   - ALL OTHER JURISDICTIONS → the primary identifier is the License Number
 *     (the jurisdiction's own `activityCode`). The ISIC code must NOT be shown.
 *
 * AFZ is recognised by the authoritative jurisdiction slug. The baseline seed
 * uses `ajman-free-zone` while the production Afz Import uses `afz`; both name
 * the same "Ajman Free Zone" jurisdiction, so both are treated as AFZ.
 *
 * Nothing here invents a value: when the required identifier is genuinely
 * missing it resolves to `null` and the copy text simply omits that line rather
 * than emitting an undefined/null/placeholder value.
 */

export const AFZ_JURISDICTION_SLUGS: ReadonlySet<string> = new Set([
  "afz",
  "ajman-free-zone",
]);

export function isAfzJurisdiction(slug: string | null | undefined): boolean {
  return AFZ_JURISDICTION_SLUGS.has((slug ?? "").trim().toLowerCase());
}

export type PrimaryIdentifierKind = "isic" | "license";

export interface PrimaryIdentifier {
  kind: PrimaryIdentifierKind;
  label: "ISIC Code" | "License Number";
  value: string | null;
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function resolvePrimaryIdentifier(input: {
  jurisdictionSlug: string | null | undefined;
  isicCode?: string | null;
  activityCode?: string | null;
}): PrimaryIdentifier {
  if (isAfzJurisdiction(input.jurisdictionSlug)) {
    return { kind: "isic", label: "ISIC Code", value: clean(input.isicCode) };
  }
  return {
    kind: "license",
    label: "License Number",
    value: clean(input.activityCode),
  };
}

/**
 * Builds the exact clipboard payload for the Copy button.
 *
 *   AFZ:        `Activity Name: <name>\nISIC Code: <isic code>`
 *   Other:      `Activity Name: <name>\nLicense Number: <license number>`
 *
 * A missing identifier omits its line entirely — an undefined/null/placeholder
 * value is never copied. Returns `null` when there is nothing worth copying.
 */
export function buildIdentifierCopyText(
  activityName: string | null | undefined,
  identifier: PrimaryIdentifier
): string | null {
  const name = activityName?.trim();
  const lines: string[] = [];
  if (name) lines.push(`Activity Name: ${name}`);
  if (identifier.value) lines.push(`${identifier.label}: ${identifier.value}`);
  return lines.length > 0 ? lines.join("\n") : null;
}