import { describe, it, expect } from "vitest";
import {
  isAfzJurisdiction,
  resolvePrimaryIdentifier,
  buildIdentifierCopyText,
} from "@/lib/activities/identifier";

/**
 * Jurisdiction-aware identifier rules:
 *
 *   AFZ (jurisdiction slug `afz` / `ajman-free-zone`) → primary identifier is
 *   the ISIC Code; the license number must never take that role.
 *
 *   All other jurisdictions → primary identifier is the License Number (the
 *   activity's own catalogue code); the ISIC code is not shown for them.
 *
 * A genuinely missing value resolves to `null`/is omitted from the copy text —
 * never invented, never a placeholder.
 */

describe("isAfzJurisdiction", () => {
  it("recognises the production Afz import slug", () => {
    expect(isAfzJurisdiction("afz")).toBe(true);
  });

  it("recognises the baseline-seed Ajman Free Zone slug", () => {
    expect(isAfzJurisdiction("ajman-free-zone")).toBe(true);
  });

  it("is case- and trim-insensitive", () => {
    expect(isAfzJurisdiction(" AFZ ")).toBe(true);
  });

  it("rejects every other jurisdiction slug", () => {
    expect(isAfzJurisdiction("dmcc")).toBe(false);
    expect(isAfzJurisdiction("rakez")).toBe(false);
    expect(isAfzJurisdiction("ifza")).toBe(false);
    expect(isAfzJurisdiction("spc")).toBe(false);
  });

  it("safely handles a missing slug", () => {
    expect(isAfzJurisdiction(null)).toBe(false);
    expect(isAfzJurisdiction(undefined)).toBe(false);
    expect(isAfzJurisdiction("")).toBe(false);
  });
});

describe("resolvePrimaryIdentifier", () => {
  it("AFZ → ISIC Code, never the License Number", () => {
    const id = resolvePrimaryIdentifier({
      jurisdictionSlug: "afz",
      isicCode: "4690018",
      activityCode: "AM-03942",
    });
    expect(id.kind).toBe("isic");
    expect(id.label).toBe("ISIC Code");
    expect(id.value).toBe("4690018");
  });

  it("ajman-free-zone slug is treated as AFZ", () => {
    const id = resolvePrimaryIdentifier({
      jurisdictionSlug: "ajman-free-zone",
      isicCode: "4690018",
      activityCode: "AM-03942",
    });
    expect(id.kind).toBe("isic");
    expect(id.value).toBe("4690018");
  });

  it("non-AFZ → License Number, never the ISIC code", () => {
    const id = resolvePrimaryIdentifier({
      jurisdictionSlug: "dmcc",
      isicCode: "4651",
      activityCode: "DMCC-0001",
    });
    expect(id.kind).toBe("license");
    expect(id.label).toBe("License Number");
    expect(id.value).toBe("DMCC-0001");
  });

  it("a missing activityCode resolves to a null License Number, not invented", () => {
    const id = resolvePrimaryIdentifier({
      jurisdictionSlug: "dmcc",
      isicCode: "4651",
      activityCode: null,
    });
    expect(id.kind).toBe("license");
    expect(id.label).toBe("License Number");
    expect(id.value).toBeNull();
  });

  it("a missing isicCode for AFZ resolves to a null ISIC value, not invented", () => {
    const id = resolvePrimaryIdentifier({
      jurisdictionSlug: "afz",
      isicCode: "",
      activityCode: "AM-03942",
    });
    expect(id.kind).toBe("isic");
    expect(id.value).toBeNull();
  });

  it("whitespace-only identifiers are treated as missing", () => {
    const id = resolvePrimaryIdentifier({
      jurisdictionSlug: "dmcc",
      isicCode: "4651",
      activityCode: "   ",
    });
    expect(id.value).toBeNull();
  });

  it("a missing slug defaults to the non-AFZ rule", () => {
    expect(
      resolvePrimaryIdentifier({ jurisdictionSlug: null, activityCode: "X-1" }).label
    ).toBe("License Number");
  });
});

describe("buildIdentifierCopyText", () => {
  it("AFZ Copy → Activity Name + ISIC Code only", () => {
    const text = buildIdentifierCopyText("General Trading Import & Export", {
      kind: "isic",
      label: "ISIC Code",
      value: "4690018",
    });
    expect(text).toBe("Activity Name: General Trading Import & Export\nISIC Code: 4690018");
  });

  it("non-AFZ Copy → Activity Name + License Number only", () => {
    const text = buildIdentifierCopyText("General Trading", {
      kind: "license",
      label: "License Number",
      value: "DMCC-0001",
    });
    expect(text).toBe("Activity Name: General Trading\nLicense Number: DMCC-0001");
  });

  it("never emits an undefined/null/placeholder identifier line", () => {
    const text = buildIdentifierCopyText("General Trading", {
      kind: "license",
      label: "License Number",
      value: null,
    });
    expect(text).toBe("Activity Name: General Trading");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
    expect(text).not.toContain("Not available");
    expect(text).not.toContain("—");
    expect(text).not.toContain("License Number:");
  });

  it("returns null when there is genuinely nothing to copy", () => {
    expect(
      buildIdentifierCopyText("   ", {
        kind: "license",
        label: "License Number",
        value: null,
      })
    ).toBeNull();
  });

  it("trims surrounding whitespace from the activity name", () => {
    const text = buildIdentifierCopyText("  Cafe  ", {
      kind: "isic",
      label: "ISIC Code",
      value: "5629",
    });
    expect(text).toBe("Activity Name: Cafe\nISIC Code: 5629");
  });
});