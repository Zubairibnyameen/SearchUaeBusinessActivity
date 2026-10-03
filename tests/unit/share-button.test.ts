import { describe, it, expect } from "vitest";
import {
  buildShareUrl,
  buildWhatsAppUrl,
  sharePathForActivity,
} from "@/components/activities/share-button";

/**
 * The share control builds a URL to a *public* activity page, so the only thing
 * that matters for confidentiality is that the link carries the activity id and
 * nothing else — no token, no session hint, no query string.
 *
 * These tests target the pure helpers; the component itself is a thin wrapper
 * that must run in a real browser, so its interactive branches are exercised by
 * the manual QA pass rather than by a DOM-less unit test.
 */

const ACTIVITY_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("share link construction", () => {
  it("builds the canonical public activity path", () => {
    expect(sharePathForActivity(ACTIVITY_ID)).toBe(`/activities/${ACTIVITY_ID}`);
  });

  it("prefixes an explicit origin without duplicating slashes", () => {
    expect(buildShareUrl("/activities/x", "https://example.com")).toBe(
      "https://example.com/activities/x"
    );
    expect(buildShareUrl("/activities/x", "https://example.com/")).toBe(
      "https://example.com/activities/x"
    );
  });

  it("falls back to the relative path when there is no origin", () => {
    // Server render: there is no window yet, so the relative path is returned
    // and the component upgrades it after mount.
    expect(buildShareUrl("/activities/x")).toBe("/activities/x");
  });

  it("never appends credentials, tokens or query state", () => {
    const url = buildShareUrl(sharePathForActivity(ACTIVITY_ID), "https://example.com");
    expect(url).toBe(`https://example.com/activities/${ACTIVITY_ID}`);
    expect(url).not.toContain("?");
    expect(url).not.toContain("token");
    expect(url).not.toContain("session");
  });
});

describe("WhatsApp deep link", () => {
  it("encodes the message and the URL together", () => {
    const href = buildWhatsAppUrl(
      "https://example.com/activities/x",
      "General Trading"
    );
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);

    const decoded = decodeURIComponent(href.replace("https://wa.me/?text=", ""));
    expect(decoded).toContain("General Trading");
    expect(decoded).toContain("https://example.com/activities/x");
  });

  it("escapes characters that would otherwise break the query string", () => {
    const href = buildWhatsAppUrl("https://example.com/a?b=1", "Trade & Retail #1");
    // A raw `&` or `#` here would silently truncate the shared text.
    expect(href).not.toMatch(/[&](?!\w+=)/);
    expect(decodeURIComponent(href)).toContain("Trade & Retail #1");
  });
});
