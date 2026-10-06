// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { CopyIdentifierButton } from "@/components/activities/copy-identifier-button";
import { PrimaryIdentifier } from "@/components/activities/primary-identifier";
import { SearchResultCard } from "@/components/search/search-results";
import type { SearchResultItem } from "@/lib/search/types";

vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return {
    default: ({ href, children }: { href?: string; children?: ReactNode }) =>
      ce("a", { href }, children),
  };
});

/**
 * Jurisdiction-aware Copy button + identifier display.
 *
 *   AFZ:   shows ISIC Code as the primary identifier; the Copy button emits
 *          `Activity Name: …` + `ISIC Code: …` — never the license number.
 *   Other: shows License Number; the Copy button emits
 *          `Activity Name: …` + `License Number: …` — never the ISIC code.
 *
 * A genuinely missing identifier is not invented, displayed as a placeholder,
 * or copied as undefined/null.
 */

const AFZ = { activityCode: "AM-03942", isicCode: "4690018" };
const DMCC = { activityCode: "DMCC-0001", isicCode: "4651" };

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeResult(
  slug: string,
  overrides: { activityCode: string | null; isicCode: string | null }
): SearchResultItem {
  return {
    activity: {
      id: `act-${slug}`,
      officialName: "General Trading",
      normalizedName: "general trading",
      activityCode: overrides.activityCode,
      isicCode: overrides.isicCode,
      description: null,
      officialCategory: "Trading",
      activityGroup: "Trading",
      approvalSignal: "no_signal",
      approvalStatus: "unknown",
      verificationStatus: "unverified",
      lastVerified: null,
    },
    jurisdiction: {
      id: `jur-${slug}`,
      name: slug === "afz" ? "Ajman Free Zone" : slug.toUpperCase(),
      slug,
      emirate: slug === "afz" ? "ajman" : "dubai",
      jurisdictionType: "free_zone",
    },
    licenceType: { id: "lt", name: "Commercial", code: "COM" },
    matchType: "exact",
    matchScore: 1,
    matchReasons: [],
    source: null,
  };
}

describe("CopyIdentifierButton", () => {
  const COPY_LABEL = "Copy Activity Name and identifier";

  it("AFZ Copy → Activity Name + ISIC Code only", async () => {
    render(
      createElement(CopyIdentifierButton, {
        activityName: "General Trading Import & Export",
        jurisdictionSlug: "afz",
        ...AFZ,
      })
    );
    const button = screen.getByRole("button", { name: COPY_LABEL });
    expect(button.getAttribute("data-identifier-kind")).toBe("isic");

    button.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(
      "Activity Name: General Trading Import & Export\nISIC Code: 4690018"
    );
  });

  it("non-AFZ Copy → Activity Name + License Number only", async () => {
    render(
      createElement(CopyIdentifierButton, {
        activityName: "General Trading",
        jurisdictionSlug: "dmcc",
        ...DMCC,
      })
    );
    const button = screen.getByRole("button", { name: COPY_LABEL });
    expect(button.getAttribute("data-identifier-kind")).toBe("license");

    button.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(
      "Activity Name: General Trading\nLicense Number: DMCC-0001"
    );
  });

  it("a missing identifier is not copied as undefined/null/placeholder", async () => {
    render(
      createElement(CopyIdentifierButton, {
        activityName: "General Trading",
        jurisdictionSlug: "dmcc",
        activityCode: null,
        isicCode: null,
      })
    );
    screen.getByRole("button", { name: COPY_LABEL }).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toBe("Activity Name: General Trading");
    expect(copied).not.toContain("undefined");
    expect(copied).not.toContain("null");
    expect(copied).not.toContain("Not available");
    expect(copied).not.toContain("—");
  });

  it("renders no button when there is nothing to copy", () => {
    render(
      createElement(CopyIdentifierButton, {
        activityName: "   ",
        jurisdictionSlug: "dmcc",
        activityCode: null,
        isicCode: null,
      })
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("confirms the copy in a live region", async () => {
    render(
      createElement(CopyIdentifierButton, {
        activityName: "General Trading",
        jurisdictionSlug: "afz",
        ...AFZ,
      })
    );
    screen.getByRole("button", { name: COPY_LABEL }).click();
    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/copied/i)
    );
  });

  it("reports a clipboard failure without throwing", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(
      createElement(CopyIdentifierButton, {
        activityName: "General Trading",
        jurisdictionSlug: "afz",
        ...AFZ,
      })
    );
    screen.getByRole("button", { name: COPY_LABEL }).click();
    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/could not copy/i)
    );
  });
});

describe("PrimaryIdentifier display", () => {
  it("AFZ → shows ISIC Code, not a License Number", () => {
    const { container } = render(
      createElement(PrimaryIdentifier, {
        jurisdictionSlug: "afz",
        isicCode: "4690018",
        activityCode: "AM-03942",
      })
    );
    expect(container.textContent).toContain("ISIC Code");
    expect(container.textContent).toContain("4690018");
    expect(container.textContent).not.toContain("License Number");
    expect(container.textContent).not.toContain("AM-03942");
  });

  it("non-AFZ → shows License Number, not an ISIC code", () => {
    const { container } = render(
      createElement(PrimaryIdentifier, {
        jurisdictionSlug: "dmcc",
        isicCode: "4651",
        activityCode: "DMCC-0001",
      })
    );
    expect(container.textContent).toContain("License Number");
    expect(container.textContent).toContain("DMCC-0001");
    expect(container.textContent).not.toContain("ISIC Code");
    expect(container.textContent).not.toContain("4651");
  });

  it("renders nothing when the required identifier is missing", () => {
    const { container } = render(
      createElement(PrimaryIdentifier, {
        jurisdictionSlug: "dmcc",
        isicCode: "4651",
        activityCode: null,
      })
    );
    expect(container.textContent).toBe("");
  });
});

describe("SearchResultCard jurisdiction-aware identifier", () => {
  it("AFZ card shows ISIC Code and hides the license number", () => {
    const { container } = render(
      createElement(SearchResultCard, {
        result: makeResult("afz", AFZ),
      })
    );
    expect(container.textContent).toContain("ISIC Code");
    expect(container.textContent).toContain("4690018");
    expect(container.textContent).not.toContain("AM-03942");
    expect(container.textContent).not.toContain("License Number");
  });

  it("non-AFZ card shows License Number and hides the ISIC code", () => {
    const { container } = render(
      createElement(SearchResultCard, {
        result: makeResult("dmcc", DMCC),
      })
    );
    expect(container.textContent).toContain("License Number");
    expect(container.textContent).toContain("DMCC-0001");
    expect(container.textContent).not.toContain("4651");
    expect(container.textContent).not.toContain("ISIC Code");
  });

  it("a card with a missing identifier displays no placeholder", () => {
    const { container } = render(
      createElement(SearchResultCard, {
        result: makeResult("dmcc", { activityCode: null, isicCode: "4651" }),
      })
    );
    expect(container.textContent).not.toContain("License Number");
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("null");
    expect(container.textContent).not.toContain("Not available");
  });
});