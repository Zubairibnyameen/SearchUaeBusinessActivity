import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildOAuthCallbackUrl,
  buildPasswordResetUrl,
  isTrustedBrowserOrigin,
  normalizeBrowserOrigin,
} from "@/lib/auth/client-origin";
import { safeNextPath } from "@/lib/auth/redirects";

/**
 * Origin resolution for client-side auth redirects.
 *
 * REQUIREMENT UNDER TEST: after Google sign-in, localhost must stay localhost
 * and production must stay production — with no hardcoded URL anywhere and no
 * dependence on a Host or X-Forwarded-Host header.
 *
 * The mechanism is `window.location.origin`, which the browser sets from the
 * address bar and no request header can forge. These tests pin both
 * environments explicitly, and pin that a hostile `Host` value could not change
 * the outcome even if one were consulted.
 */

const LOCALHOST = "http://localhost:3000";
const PRODUCTION = "https://search-uae-business-activity.vercel.app";

describe("trusted browser origin", () => {
  it("accepts a plain localhost origin", () => {
    expect(isTrustedBrowserOrigin(LOCALHOST)).toBe(true);
  });

  it("accepts the production origin", () => {
    expect(isTrustedBrowserOrigin(PRODUCTION)).toBe(true);
  });

  it("accepts a non-default port, which is how an alternate dev port looks", () => {
    expect(isTrustedBrowserOrigin("http://localhost:3001")).toBe(true);
  });

  it("accepts a trailing slash and normalises it away", () => {
    expect(normalizeBrowserOrigin(`${LOCALHOST}/`)).toBe(LOCALHOST);
  });

  it("accepts surrounding whitespace", () => {
    expect(normalizeBrowserOrigin(`  ${PRODUCTION}  `)).toBe(PRODUCTION);
  });

  it("rejects an empty or missing value", () => {
    expect(isTrustedBrowserOrigin("")).toBe(false);
    expect(isTrustedBrowserOrigin(null)).toBe(false);
    expect(isTrustedBrowserOrigin(undefined)).toBe(false);
    expect(isTrustedBrowserOrigin("   ")).toBe(false);
  });

  it("rejects a bare host with no scheme", () => {
    // A relative value would otherwise resolve against whatever the browser
    // happened to be showing.
    expect(isTrustedBrowserOrigin("localhost:3000")).toBe(false);
  });

  it("rejects non-http schemes that new URL() would otherwise accept", () => {
    expect(isTrustedBrowserOrigin("javascript:alert(1)")).toBe(false);
    expect(isTrustedBrowserOrigin("data:text/html,<script>")).toBe(false);
    expect(isTrustedBrowserOrigin("file:///etc/passwd")).toBe(false);
  });

  it("rejects an origin carrying credentials", () => {
    // Both of these parse cleanly and both would send the provider's redirect
    // to a host of the attacker's choosing while looking like a bare origin.
    expect(isTrustedBrowserOrigin("https://user:pass@evil.test")).toBe(false);
    expect(isTrustedBrowserOrigin("https://search-uae-business-activity.vercel.app@evil.test")).toBe(
      false
    );
  });

  it("rejects a full URL where a bare origin was expected", () => {
    expect(isTrustedBrowserOrigin(`${PRODUCTION}/auth/callback`)).toBe(false);
    expect(isTrustedBrowserOrigin(`${PRODUCTION}/?next=/`)).toBe(false);
    expect(isTrustedBrowserOrigin(`${PRODUCTION}#x`)).toBe(false);
  });

  it("rejects an absurdly long value rather than hashing or storing it", () => {
    expect(isTrustedBrowserOrigin(`https://${"a".repeat(400)}.test`)).toBe(false);
  });
});

describe("OAuth callback redirect, per environment", () => {
  it("stays on localhost when the browser is on localhost", () => {
    const url = buildOAuthCallbackUrl(LOCALHOST, "/search");
    expect(url).toBe(
      `${LOCALHOST}/auth/callback?next=${encodeURIComponent("/search")}`
    );
    expect(url?.startsWith("http://localhost:3000/")).toBe(true);
    expect(url).not.toContain("vercel.app");
  });

  it("stays on the deployed domain in production", () => {
    const url = buildOAuthCallbackUrl(PRODUCTION, "/search");
    expect(url).toBe(
      `${PRODUCTION}/auth/callback?next=${encodeURIComponent("/search")}`
    );
    expect(url).not.toContain("localhost");
  });

  it("honours a different dev port instead of snapping to 3000", () => {
    // A developer on :3001 must come back to :3001, or the PKCE verifier
    // stored under one origin will not match the callback under another.
    expect(buildOAuthCallbackUrl("http://localhost:3001", "/")).toBe(
      "http://localhost:3001/auth/callback?next=%2F"
    );
  });

  it("supports the 127.0.0.1 loopback spelling", () => {
    expect(buildOAuthCallbackUrl("http://127.0.0.1:3000", "/")).toContain(
      "http://127.0.0.1:3000/auth/callback"
    );
  });

  it("produces no URL at all when the origin cannot be proven", () => {
    expect(buildOAuthCallbackUrl(null, "/")).toBeNull();
    expect(buildOAuthCallbackUrl("not-a-url", "/")).toBeNull();
    expect(buildOAuthCallbackUrl("https://a@b.test", "/")).toBeNull();
  });

  it("never emits the production host while on localhost", () => {
    // The specific regression: a hardcoded production constant leaking into a
    // local developer's OAuth flow.
    const url = buildOAuthCallbackUrl(LOCALHOST, "/");
    expect(url).not.toMatch(/vercel\.app/);
  });

  it("never emits localhost while in production", () => {
    const url = buildOAuthCallbackUrl(PRODUCTION, "/");
    expect(url).not.toMatch(/localhost/);
  });
});

describe("OAuth callback redirect, next-path handling", () => {
  it("percent-encodes the destination so it cannot break out of the query", () => {
    const hostile = "/x?next=https://evil.test#";
    const url = buildOAuthCallbackUrl(PRODUCTION, safeNextPath(hostile));
    expect(url).toContain(encodeURIComponent(hostile));
  });

  it("carries the caller-supplied next path through unchanged when it is safe", () => {
    expect(buildOAuthCallbackUrl(LOCALHOST, "/search?q=licence")).toBe(
      `${LOCALHOST}/auth/callback?next=${encodeURIComponent("/search?q=licence")}`
    );
  });

  it("falls back to the default destination for an absolute next", () => {
    // safeNextPath already collapses this; the builder must not re-expand it.
    expect(buildOAuthCallbackUrl(PRODUCTION, safeNextPath("https://evil.test"))).toBe(
      `${PRODUCTION}/auth/callback?next=${encodeURIComponent("/")}`
    );
  });
});

describe("password reset landing URL", () => {
  it("targets /reset-password on the current origin", () => {
    expect(buildPasswordResetUrl(LOCALHOST)).toBe(`${LOCALHOST}/reset-password`);
    expect(buildPasswordResetUrl(PRODUCTION)).toBe(
      `${PRODUCTION}/reset-password`
    );
  });

  it("is environment-aware, not hardcoded", () => {
    expect(buildPasswordResetUrl(LOCALHOST)).not.toContain("vercel.app");
    expect(buildPasswordResetUrl(PRODUCTION)).not.toContain("localhost");
  });

  it("refuses to build a URL from an untrusted origin", () => {
    expect(buildPasswordResetUrl("javascript:alert(1)")).toBeNull();
    expect(buildPasswordResetUrl(null)).toBeNull();
  });

  it("carries no token, query or fragment of its own", () => {
    // The recovery token is appended by the provider, not by us; the base URL
    // must be clean so nothing here can pre-empt or shadow it.
    expect(buildPasswordResetUrl(PRODUCTION)).not.toContain("token");
    expect(buildPasswordResetUrl(PRODUCTION)).not.toContain("?");
    expect(buildPasswordResetUrl(PRODUCTION)).not.toContain("#");
  });
});

describe("no unsafe hardcoding of the production origin", () => {
  const PRODUCTION_HOST = "search-uae-business-activity.vercel.app";

  /** Source of the auth modules that decide where a redirect points. */
  const AUTH_REDIRECT_SOURCES = [
    "src/lib/auth/client-origin.ts",
    "src/components/auth/google-sign-in-button.tsx",
    "src/app/auth/callback/route.ts",
    "src/app/(public)/auth/actions.ts",
  ];

  it("no auth redirect module contains the production host as a literal", () => {
    // The requirement that started this work: a hardcoded production URL inside
    // auth/redirect logic is what makes local development sign in against
    // production. The origin must come from the browser or from configuration.
    const offenders: string[] = [];
    for (const relative of AUTH_REDIRECT_SOURCES) {
      const source = readFileSync(join(process.cwd(), relative), "utf8");
      if (source.includes(PRODUCTION_HOST)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });

  it("emits the production host only when the production origin is supplied", () => {
    expect(buildOAuthCallbackUrl(PRODUCTION, "/")).toContain(PRODUCTION_HOST);
    expect(buildOAuthCallbackUrl(LOCALHOST, "/")).not.toContain(PRODUCTION_HOST);
  });
});