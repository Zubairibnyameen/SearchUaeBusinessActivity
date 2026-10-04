// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { ShareButton } from "@/components/activities/share-button";

/**
 * Interactive cover for the share control that now appears on every search
 * result card.
 *
 * The requirement is a priority order, not three buttons: use the platform
 * share sheet where the browser has one, fall back to the clipboard everywhere
 * else, and never surface an error to the reader. In the compact variant that
 * has to fit in a single control beside the primary "View details" action.
 */

const ACTIVITY_ID = "550e8400-e29b-41d4-a716-446655440000";
const TITLE = "General Trading";

function renderShare(props: Record<string, unknown> = {}) {
  return render(
    createElement(ShareButton, {
      activityId: ACTIVITY_ID,
      title: TITLE,
      variant: "compact",
      ...props,
    })
  );
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  // Default: no platform share sheet.
  Object.defineProperty(navigator, "share", {
    value: undefined,
    configurable: true,
  });
});

/** The jsdom document origin; the component builds absolute URLs from it. */
function canonicalUrl(): string {
  return `${window.location.origin}/activities/${ACTIVITY_ID}`;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("compact share control", () => {
  it("renders a single control, with no WhatsApp shortcut competing for space", () => {
    renderShare();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("names the activity for assistive technology", () => {
    renderShare();
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toBe(`Copy link to ${TITLE}`);
  });

  it("copies the canonical public activity URL when there is no share sheet", async () => {
    renderShare();
    screen.getByRole("button").click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(canonicalUrl());
  });

  it("never copies a URL carrying query state or credentials", async () => {
    renderShare();
    screen.getByRole("button").click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).not.toContain("?");
    expect(copied).not.toMatch(/token|session|q=/i);
  });

  it("confirms the copy in a live region", async () => {
    renderShare();
    screen.getByRole("button").click();
    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/copied/i)
    );
  });

  it("prefers the platform share sheet when the browser provides one", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });

    renderShare();
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toBe(`Share ${TITLE}`);

    button.click();
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0]).toMatchObject({
      title: TITLE,
      url: canonicalUrl(),
    });
    // The share sheet is the action; the clipboard is not used behind its back.
    expect(writeText).not.toHaveBeenCalled();
  });

  it("treats a cancelled share sheet as a no-op, not a failure", async () => {
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(new Error("AbortError")),
      configurable: true,
    });
    renderShare();
    screen.getByRole("button").click();
    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).not.toMatch(/could not/i)
    );
  });

  it("reports a clipboard failure without throwing", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderShare();
    screen.getByRole("button").click();
    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/could not copy/i)
    );
  });
});

describe("full share control is unchanged", () => {
  it("still offers the WhatsApp shortcut and a copy button", () => {
    renderShare({ variant: "full" });
    expect(screen.getByRole("link", { name: /whatsapp/i })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `Copy link to ${TITLE}` })
    ).toBeTruthy();
  });

  it("adds the native share button when the browser has a share sheet", () => {
    Object.defineProperty(navigator, "share", {
      value: vi.fn(),
      configurable: true,
    });
    renderShare({ variant: "full" });
    expect(screen.getByRole("button", { name: `Share ${TITLE}` })).toBeTruthy();
  });
});

