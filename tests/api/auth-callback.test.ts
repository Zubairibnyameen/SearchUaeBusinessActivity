import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { authViewerMock } from "../helpers/auth-mock";

/**
 * The OAuth and recovery callback.
 *
 * This is the single place a `code` becomes a session, so it carries the two
 * properties the rest of the auth work rests on:
 *
 *   - WHERE IT SENDS PEOPLE. Localhost must stay localhost and the deployment
 *     must stay the deployment, with no hardcoded URL and no dependence on a
 *     `Host` or `X-Forwarded-Host` header an attacker could influence.
 *   - WHAT IT DOES BEFORE REDIRECTING. The session exchange must complete and
 *     the profile must be projected, so no request ever lands on a page holding
 *     a session with no `app_users` row behind it.
 */

vi.mock("@/lib/auth/viewer", async () => ({
  ...(await authViewerMock()),
  getAuthIdentity: vi.fn(async () => null),
  syncSignedInProfile: vi.fn(async () => null),
}));

const authDouble = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
}));
const clientDouble = vi.hoisted(() => ({ auth: authDouble }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => clientDouble),
}));

const configured = { value: true };
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => configured.value,
}));

let callbackGET: typeof import("@/app/auth/callback/route").GET;
let viewer: typeof import("@/lib/auth/viewer");

const LOCALHOST = "http://localhost:3000";
const PRODUCTION = "https://search-uae-business-activity.vercel.app";

beforeAll(async () => {
  callbackGET = (await import("@/app/auth/callback/route")).GET;
  viewer = await import("@/lib/auth/viewer");
});

beforeEach(() => {
  vi.clearAllMocks();
  configured.value = true;
  authDouble.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
  // Re-armed, not merely cleared: `mockRejectedValue` from a test below would
  // otherwise survive `clearAllMocks()` and fail the next one for the wrong
  // reason.
  vi.mocked(viewer.getAuthIdentity).mockResolvedValue(null);
  vi.mocked(viewer.syncSignedInProfile).mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/**
 * Build a request to the callback.
 *
 * `origin` sets the URL Next would have derived, which is what the redirect is
 * resolved against. Nothing here is read from a header.
 */
function request(origin: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL("/auth/callback", origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new NextRequest(url);
}

/** The `Location` header of the redirect the handler returned. */
function locationOf(response: Response): string {
  return response.headers.get("location") ?? "";
}

/** A signed-in identity, for the projection assertions. */
const identity = {
  authUserId: "auth-1",
  email: "layla@example.com",
  fullName: "Layla Hassan",
  avatarUrl: null,
} as unknown as Awaited<ReturnType<typeof viewer.getAuthIdentity>>;

describe("Google sign-in return destination — local development", () => {
  it("returns the person to localhost", async () => {
    const response = await callbackGET(request(LOCALHOST, { code: "abc", next: "/search" }));
    expect(locationOf(response)).toBe(`${LOCALHOST}/search`);
  });

  it("sends them back to the origin the flow started from", async () => {
    // No environment branch anywhere in the handler: the request's own origin is
    // what it returns to, so localhost and production need no separate code.
    const response = await callbackGET(request(LOCALHOST, { code: "abc", next: "/account" }));
    expect(locationOf(response).startsWith(LOCALHOST)).toBe(true);
  });

  it("honours a non-default dev port", async () => {
    // The PKCE verifier was stored under :3001, so returning to :3000 would
    // present a cookie the provider does not recognise.
    const response = await callbackGET(
      request("http://localhost:3001", { code: "abc", next: "/search" })
    );
    expect(locationOf(response)).toBe("http://localhost:3001/search");
  });

  it("never sends a local sign-in to the deployed domain", async () => {
    const response = await callbackGET(request(LOCALHOST, { code: "abc", next: "/" }));
    expect(locationOf(response)).not.toMatch(/vercel\.app/);
  });
});

describe("Google sign-in return destination — production", () => {
  it("returns the person to the deployment", async () => {
    const response = await callbackGET(request(PRODUCTION, { code: "abc", next: "/search" }));
    expect(locationOf(response)).toBe(`${PRODUCTION}/search`);
  });

  it("never sends a production sign-in to localhost", async () => {
    const response = await callbackGET(request(PRODUCTION, { code: "abc", next: "/" }));
    expect(locationOf(response)).not.toMatch(/localhost/);
  });

  it("sends a failure back to the deployment's sign-in page", async () => {
    authDouble.exchangeCodeForSession.mockResolvedValue({
      error: { message: "bad code" },
    });
    const response = await callbackGET(request(PRODUCTION, { code: "abc" }));
    expect(locationOf(response)).toBe(`${PRODUCTION}/signin?error=exchange_failed`);
  });
});

describe("open redirect containment", () => {
  it("refuses an absolute next and lands on the root instead", async () => {
    const response = await callbackGET(
      request(PRODUCTION, { code: "abc", next: "https://evil.test/steal" })
    );
    expect(locationOf(response)).toBe(`${PRODUCTION}/`);
  });

  it("refuses a protocol-relative next", async () => {
    const response = await callbackGET(
      request(PRODUCTION, { code: "abc", next: "//evil.test" })
    );
    expect(locationOf(response)).toBe(`${PRODUCTION}/`);
  });

  it("refuses a javascript: next", async () => {
    const response = await callbackGET(
      request(PRODUCTION, { code: "abc", next: "javascript:alert(1)" })
    );
    expect(locationOf(response)).not.toMatch(/javascript:/i);
  });

  it("cannot be redirected off-origin by any next value", async () => {
    for (const next of [
      "https://evil.test",
      "//evil.test",
      "http://evil.test",
      "\\\\evil.test",
      "/\\evil.test",
    ]) {
      const response = await callbackGET(request(PRODUCTION, { code: "abc", next }));
      expect(locationOf(response).startsWith(PRODUCTION)).toBe(true);
    }
  });

  it("keeps a same-origin path with a query intact", async () => {
    const response = await callbackGET(
      request(LOCALHOST, { code: "abc", next: "/search?q=licence&jurisdiction=dubai" })
    );
    expect(locationOf(response)).toBe(
      `${LOCALHOST}/search?q=licence&jurisdiction=dubai`
    );
  });
});

describe("code exchange and profile projection", () => {
  it("exchanges the code for a session", async () => {
    await callbackGET(request(LOCALHOST, { code: "the-code" }));
    expect(authDouble.exchangeCodeForSession).toHaveBeenCalledWith("the-code");
  });

  it("projects the profile before redirecting", async () => {
    // The property that keeps Google and password users equivalent: no request
    // lands on a page holding a session with no `app_users` row behind it.
    vi.mocked(viewer.getAuthIdentity).mockResolvedValue(identity);
    await callbackGET(request(LOCALHOST, { code: "abc" }));
    expect(viewer.syncSignedInProfile).toHaveBeenCalledTimes(1);
    expect(viewer.syncSignedInProfile).toHaveBeenCalledWith(identity);
  });

  it("still redirects when the projection fails", async () => {
    // Authorization is re-checked on every admin request regardless, so a
    // database hiccup here must not strand somebody mid sign-in.
    vi.mocked(viewer.getAuthIdentity).mockResolvedValue(identity);
    vi.mocked(viewer.syncSignedInProfile).mockRejectedValue(new Error("db down"));
    const response = await callbackGET(request(LOCALHOST, { code: "abc", next: "/search" }));
    expect(locationOf(response)).toBe(`${LOCALHOST}/search`);
  });

  it("does not project anything when the exchange failed", async () => {
    // A failed exchange means no verified identity; projecting then would write
    // a row for a session that does not exist.
    authDouble.exchangeCodeForSession.mockResolvedValue({ error: { message: "bad" } });
    await callbackGET(request(LOCALHOST, { code: "abc" }));
    expect(viewer.syncSignedInProfile).not.toHaveBeenCalled();
  });

  it("does not exchange anything when the code is absent", async () => {
    const response = await callbackGET(request(LOCALHOST, {}));
    expect(authDouble.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(locationOf(response)).toBe(`${LOCALHOST}/signin?error=missing_code`);
  });

  it("logs a failed exchange without leaking provider wording", async () => {
    authDouble.exchangeCodeForSession.mockResolvedValue({
      error: { message: 'invalid code: "pkce_verifier" mismatch' },
    });
    await callbackGET(request(LOCALHOST, { code: "abc" }));
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[auth]"),
      'invalid code: "pkce_verifier" mismatch'
    );
    // The person is told a generic reason code instead.
    const response = await callbackGET(request(LOCALHOST, { code: "abc" }));
    expect(locationOf(response)).toContain("exchange_failed");
  });

  it("survives a thrown transport error", async () => {
    authDouble.exchangeCodeForSession.mockRejectedValue(new Error("ECONNREFUSED"));
    const response = await callbackGET(request(LOCALHOST, { code: "abc" }));
    expect(locationOf(response)).toBe(`${LOCALHOST}/signin?error=unexpected`);
  });

  it("reports an unconfigured deployment without contacting the provider", async () => {
    configured.value = false;
    const response = await callbackGET(request(LOCALHOST, { code: "abc" }));
    expect(authDouble.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(locationOf(response)).toBe(`${LOCALHOST}/signin?error=unconfigured`);
  });

  it("never exposes the code in a redirect", async () => {
    const response = await callbackGET(request(PRODUCTION, { code: "secret-code" }));
    expect(locationOf(response)).not.toContain("secret-code");
  });

  it("uses a one-time code only once it has been exchanged", async () => {
    await callbackGET(request(LOCALHOST, { code: "abc" }));
    expect(authDouble.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });
});

describe("recovery link return destination", () => {
  it("lands the person on the reset form", async () => {
    // The emailed link carries `next=/reset-password` through the same callback,
    // which is what establishes the recovery session before the form is shown.
    const response = await callbackGET(
      request(PRODUCTION, { code: "recovery-code", next: "/reset-password" })
    );
    expect(locationOf(response)).toBe(`${PRODUCTION}/reset-password`);
  });

  it("keeps recovery on localhost in local development", async () => {
    const response = await callbackGET(
      request(LOCALHOST, { code: "recovery-code", next: "/reset-password" })
    );
    expect(locationOf(response)).toBe(`${LOCALHOST}/reset-password`);
  });

  it("does not project a profile for a recovery exchange any differently", async () => {
    vi.mocked(viewer.getAuthIdentity).mockResolvedValue(identity);
    await callbackGET(request(LOCALHOST, { code: "recovery-code", next: "/reset-password" }));
    // The row already exists; re-stamping keeps `lastLoginAt` consistent.
    expect(viewer.syncSignedInProfile).toHaveBeenCalledTimes(1);
  });

  it("cannot carry a recovery link off-origin", async () => {
    const response = await callbackGET(
      request(PRODUCTION, { code: "recovery-code", next: "https://evil.test" })
    );
    expect(locationOf(response)).toBe(`${PRODUCTION}/`);
  });
});