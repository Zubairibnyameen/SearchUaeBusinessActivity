import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { authViewerMock } from "../helpers/auth-mock";
import type { AuthActionState } from "@/lib/auth/action-state";

/**
 * The four email + password server actions.
 *
 * These are the flows that hold credentials, so the assertions here are less
 * about happy paths and more about what must NOT happen:
 *
 *   - a raw provider error never reaches a person;
 *   - a password never appears in any returned state (every field of
 *     `AuthActionState` is rendered);
 *   - forgot password is indistinguishable for a registered address, an
 *     unregistered one, a provider outage and a throttled request;
 *   - a reset cannot be performed without a recovery session, and cannot be
 *     aimed at an account chosen by the form;
 *   - `syncSignedInProfile()` runs on the same paths the OAuth callback uses, so
 *     password users are not second-class for authorization;
 *   - and every emailed link is addressed to the configured origin.
 */

vi.mock("@/lib/auth/viewer", async () => ({
  /**
   * `authViewerMock()` is reused for its session gates, but the flows under test
   * additionally need the identity + projection seam, which that factory does
   * not provide.
   */
  ...(await authViewerMock()),
  getAuthIdentity: vi.fn(async () => null),
  syncSignedInProfile: vi.fn(async () => null),
}));

/*
 * RATE LIMITING IS STUBBED TO `true` (allowed) HERE.
 *   The limiter's own behaviour is covered in `search-rate-limit.test.ts`. What
 *   matters in this file is that a flow *consults* it, which the dedicated
 *   throttle block below proves by flipping this flag. Leaving it real would
 *   also make these tests order-dependent: the limiter is process-local, so
 *   twenty sign-in tests sharing one address would exhaust one shared allowance.
 */
const rateLimitAllowed = { value: true };
vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: vi.fn(() => rateLimitAllowed.value),
}));

/** Supabase auth client double; each method is replaced per test. */
const authDouble = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
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

/** The configured origin, as Vercel/local would provide it. */
let appOrigin: string | null = "http://localhost:3000";
vi.mock("@/lib/app-origin", () => ({
  getConfiguredOrigin: () => appOrigin,
  resolveAppOrigin: (raw?: string | null) => raw ?? "http://localhost:3000",
}));

/**
 * `redirect()` is recorded by throwing, exactly as Next does.
 *
 * Real `redirect()` throws a `NEXT_REDIRECT` error. Modelling that faithfully is
 * what lets these tests catch a `redirect()` swallowed by a surrounding
 * `catch` — which is exactly the bug that shipped in `signUpWithEmailAction`.
 *
 * The literal is repeated inside the factory because a `vi.mock` body is
 * hoisted above module-level declarations, so it cannot close over a `const`
 * declared here.
 */
const redirectCalls: string[] = [];
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    redirectCalls.push(to);
    const err = new Error(`NEXT_REDIRECT: ${to}`);
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${to};307;`;
    throw err;
  }),
}));

let actions: typeof import("@/app/(public)/auth/actions");
let viewer: typeof import("@/lib/auth/viewer");
let checkRateLimit: typeof import("@/lib/auth/rate-limit").checkRateLimit;

beforeAll(async () => {
  actions = await import("@/app/(public)/auth/actions");
  viewer = await import("@/lib/auth/viewer");
  checkRateLimit = (await import("@/lib/auth/rate-limit")).checkRateLimit;
});

beforeEach(() => {
  vi.clearAllMocks();
  redirectCalls.length = 0;
  rateLimitAllowed.value = true;
  configured.value = true;
  appOrigin = "http://localhost:3000";

  /*
   * IMPLEMENTATIONS ARE RE-ARMED, NOT JUST CLEARED.
   *   `vi.clearAllMocks()` erases call history but leaves any
   *   `mockImplementation` in place — so the one test that installs a
   *   call-order-recording limiter would otherwise leak `return true` into every
   *   later test and make the throttle assertions pass for the wrong reason.
   */
  vi.mocked(checkRateLimit).mockImplementation(() => rateLimitAllowed.value);
  for (const fn of Object.values(authDouble)) fn.mockReset();
  vi.mocked(viewer.getAuthIdentity).mockResolvedValue(null);
  vi.mocked(viewer.syncSignedInProfile).mockResolvedValue(null);

  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** FormData shaped like the browser's, from a plain object. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const PASSWORD = "licence2024";
const prevState = { ok: false, message: "", code: "unknown" as const };

/** A signed-in identity, for the profile-projection assertions. */
function identity() {
  return {
    authUserId: "auth-1",
    email: "layla@example.com",
    fullName: "Layla Hassan",
    avatarUrl: null,
    provider: "email",
  } as unknown as NonNullable<Awaited<ReturnType<typeof viewer.getAuthIdentity>>>;
}

/** Signature shared by all four actions. */
type AuthAction = (
  prev: AuthActionState,
  data: FormData
) => Promise<AuthActionState>;

/** Run an action and return the redirect target it threw for, if any. */
async function run(
  action: AuthAction,
  fields: Record<string, string>
): Promise<{ state?: AuthActionState; redirect?: string }> {
  return runForm(action, form(fields));
}

/** As `run`, but for a hand-built FormData carrying extra fields. */
async function runForm(
  action: AuthAction,
  data: FormData
): Promise<{ state?: AuthActionState; redirect?: string }> {
  try {
    const state = await action(prevState, data);
    return { state };
  } catch (err) {
    const digest = (err as Error & { digest?: string })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      return { redirect: redirectCalls.at(-1) };
    }
    throw err;
  }
}

describe("signInWithEmailAction — success", () => {
  beforeEach(() => {
    authDouble.signInWithPassword.mockResolvedValue({ error: null });
    vi.mocked(viewer.getAuthIdentity).mockResolvedValue(identity());
  });

  it("calls signInWithPassword with the submitted credentials", async () => {
    await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
    });
    expect(authDouble.signInWithPassword).toHaveBeenCalledWith({
      email: "layla@example.com",
      password: PASSWORD,
    });
  });

  it("normalises the address before it reaches the provider", async () => {
    await run(actions.signInWithEmailAction, {
      email: "  Layla@Example.COM ",
      password: PASSWORD,
    });
    expect(authDouble.signInWithPassword).toHaveBeenCalledWith({
      email: "layla@example.com",
      password: PASSWORD,
    });
  });

  it("projects the profile, so a password user is not second-class", async () => {
    // THE POINT OF THIS SUITE: the OAuth callback calls `syncSignedInProfile`,
    // and if sign-in skipped it a password user would exist with no `app_users`
    // row — invisible to every downstream authorization check.
    await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
    });
    expect(viewer.syncSignedInProfile).toHaveBeenCalledTimes(1);
  });

  it("redirects to the requested same-origin path on success", async () => {
    const { redirect } = await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
      next: "/search?q=licence",
    });
    expect(redirect).toBe("/search?q=licence");
  });

  it("redirects to the root by default", async () => {
    const { redirect } = await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
    });
    expect(redirect).toBe("/");
  });

  it("refuses an off-site next path and falls back to the root", async () => {
    const { redirect } = await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
      next: "https://evil.test/steal",
    });
    expect(redirect).toBe("/");
  });

  it("returns nothing at all on success, so no state is rendered", async () => {
    // A successful sign-in navigates. Any state returned here would be a second,
    // contradictory message on the way out.
    const { state } = await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
    });
    expect(state).toBeUndefined();
  });
});

describe("signInWithEmailAction — failure", () => {
  it("never contacts the provider when the form is invalid", async () => {
    const { state } = await run(actions.signInWithEmailAction, {
      email: "not-an-email",
      password: PASSWORD,
    });
    expect(authDouble.signInWithPassword).not.toHaveBeenCalled();
    expect(state?.message).toMatch(/valid email/i);
  });

  it("returns safe copy, not the provider's wording, on bad credentials", async () => {
    authDouble.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    const { state } = await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: "wrong-password",
    });
    expect(state?.message).not.toMatch(/invalid login credentials/i);
    expect(state?.message).toMatch(/not correct/i);
  });

  it("logs the provider error server-side while showing only our copy", async () => {
    authDouble.signInWithPassword.mockResolvedValue({
      error: { message: "Database error: auth_users_email_key violation" },
    });
    await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: "wrong-password",
    });
    expect(console.error).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[auth]"),
      expect.stringContaining("auth_users_email_key")
    );
  });

  it("does not redirect on failure", async () => {
    authDouble.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    const { redirect } = await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: "wrong-password",
    });
    expect(redirect).toBeUndefined();
  });

  it("returns no password in the failure state", async () => {
    authDouble.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    const { state } = await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: "wrong-password",
    });
    expect(JSON.stringify(state)).not.toContain("wrong-password");
  });

  it("does not leak that an address is unregistered", async () => {
    // "Email not found" is a subset of "wrong credentials" as far as the person
    // is concerned; a distinct message would enumerate accounts.
    authDouble.signInWithPassword.mockResolvedValue({
      error: { message: "Email not found" },
    });
    const { state } = await run(actions.signInWithEmailAction, {
      email: "ghost@example.com",
      password: "whatever1",
    });
    expect(state?.message).not.toMatch(/no account|not found|does ?n.t exist|unregistered/i);
  });

  it("reports an unconfirmed address with actionable copy", async () => {
    authDouble.signInWithPassword.mockResolvedValue({
      error: { message: "Email not confirmed" },
    });
    const { state } = await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
    });
    expect(state?.message).toMatch(/confirm your email/i);
  });

  it("surfaces a provider outage as retryable, not as bad credentials", async () => {
    authDouble.signInWithPassword.mockRejectedValue(new Error("ECONNREFUSED"));
    const { state } = await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
    });
    expect(state?.message).toMatch(/try again/i);
  });

  it("reports a missing deployment configuration plainly", async () => {
    configured.value = false;
    const { state } = await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
    });
    expect(state?.message).toMatch(/not available on this deployment/i);
    expect(authDouble.signInWithPassword).not.toHaveBeenCalled();
  });

  it("tells the caller to wait when throttled", async () => {
    rateLimitAllowed.value = false;
    const { state } = await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
    });
    expect(state?.message).toMatch(/too many attempts|wait/i);
    expect(authDouble.signInWithPassword).not.toHaveBeenCalled();
  });

  it("checks the limiter before the provider, not after", async () => {
    // Cost ordering: a credential attack should cost a Map lookup, not a network
    // round trip, for every guess.
    const order: string[] = [];
    vi.mocked(checkRateLimit).mockImplementation(() => {
      order.push("limit");
      return true;
    });
    authDouble.signInWithPassword.mockImplementation(async () => {
      order.push("provider");
      return { error: null };
    });
    vi.mocked(viewer.getAuthIdentity).mockResolvedValue(null);

    await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
    });
    expect(order).toEqual(["limit", "provider"]);
  });

  it("keys the limiter on a hash, never the plaintext address", async () => {
    await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
    });
    const key = vi.mocked(checkRateLimit).mock.calls.at(-1)?.[0] as string;
    expect(key).toMatch(/^signin:[0-9a-f]{32}$/);
    expect(key).not.toContain("layla");
  });

  it("gives sign-in its own limiter namespace", async () => {
    // Otherwise a reset-request flood would lock a real person out of signing in.
    await run(actions.signInWithEmailAction, {
      email: "layla@example.com",
      password: PASSWORD,
    });
    expect(vi.mocked(checkRateLimit).mock.calls.at(-1)?.[0]).toMatch(/^signin:/);
  });
});

describe("signUpWithEmailAction — confirmation required (the default path)", () => {
  beforeEach(() => {
    // Confirmation enabled: user created, NO session.
    authDouble.signUp.mockResolvedValue({
      data: { user: { id: "auth-1" }, session: null },
      error: null,
    });
  });

  it("passes the password to signUp and nothing else", async () => {
    await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    const args = authDouble.signUp.mock.calls.at(-1)?.[0] as {
      email: string;
      password: string;
      options: { data: Record<string, unknown> };
    };
    expect(args.email).toBe("layla@example.com");
    expect(args.password).toBe(PASSWORD);
  });

  it("seeds the display name so the first render is not a blank name", async () => {
    await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    const args = authDouble.signUp.mock.calls.at(-1)?.[0] as {
      options: { data: Record<string, unknown> };
    };
    expect(args.options.data.full_name).toBe("Layla Hassan");
  });

  it("says to check the inbox", async () => {
    const { state } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state?.message).toMatch(/inbox/i);
  });

  it("returns the address so the form can prefill it", async () => {
    const { state } = (await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    })) as { state: { message: string; email?: string } };
    expect(state.email).toBe("layla@example.com");
  });

  it("does not sign the person in", async () => {
    const { redirect } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(redirect).toBeUndefined();
    expect(viewer.syncSignedInProfile).not.toHaveBeenCalled();
  });

  it("rejects a mismatch before contacting the provider", async () => {
    const { state } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: "different1",
    });
    expect(authDouble.signUp).not.toHaveBeenCalled();
    expect(state?.message).toMatch(/do not match/i);
  });

  it("rejects a weak password before contacting the provider", async () => {
    const { state } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: "abc",
      confirmPassword: "abc",
    });
    expect(authDouble.signUp).not.toHaveBeenCalled();
    expect(state?.message).toMatch(/at least/i);
  });

  it("ignores a payload carrying an authorization field", async () => {
    /*
     * The action builds its input from four named `form.get()` calls, so a
     * crafted `role`/`status` never reaches the schema — and never reaches
     * `signUp` either. This is the structural reason `.strict()` is belt-and-
     * braces here: the field list is the allowlist.
     */
    const data = form({
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    data.append("role", "admin");
    data.append("status", "active");

    await actions.signUpWithEmailAction(prevState, data);

    const options = authDouble.signUp.mock.calls.at(-1)?.[0] as {
      options: Record<string, unknown>;
    };
    expect(options.options.role).toBeUndefined();
    expect(options.options.status).toBeUndefined();
    expect(JSON.stringify(options.options)).not.toMatch(/admin/);
  });

  it("returns no password in the confirmation state", async () => {
    const { state } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(JSON.stringify(state)).not.toContain(PASSWORD);
  });

  it("uses its own limiter namespace", async () => {
    await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(vi.mocked(checkRateLimit).mock.calls.at(-1)?.[0]).toMatch(/^signup:/);
  });
});

describe("signUpWithEmailAction — confirmation link destination", () => {
  beforeEach(() => {
    authDouble.signUp.mockResolvedValue({
      data: { user: { id: "auth-1" }, session: null },
      error: null,
    });
  });

  async function redirectTo(): Promise<string> {
    await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
      next: "/search",
    });
    const args = authDouble.signUp.mock.calls.at(-1)?.[0] as {
      options: { emailRedirectTo: string };
    };
    return args.options.emailRedirectTo;
  }

  it("addresses the confirmation link to localhost in local development", async () => {
    expect(await redirectTo()).toBe(
      "http://localhost:3000/auth/callback?next=%2Fsearch"
    );
  });

  it("addresses the confirmation link to the deployment in production", async () => {
    appOrigin = "https://search-uae-business-activity.vercel.app";
    expect(await redirectTo()).toBe(
      "https://search-uae-business-activity.vercel.app/auth/callback?next=%2Fsearch"
    );
  });

  it("never contains a production host while developing locally", async () => {
    expect(await redirectTo()).not.toMatch(/vercel\.app/);
  });

  it("never contains localhost in production", async () => {
    appOrigin = "https://search-uae-business-activity.vercel.app";
    expect(await redirectTo()).not.toMatch(/localhost/);
  });

  it("routes through the PKCE callback rather than a bare page", async () => {
    // The callback is what exchanges the code for a session. A confirmation link
    // pointing anywhere else leaves the person confirmed but not signed in.
    expect(await redirectTo()).toContain("/auth/callback?");
  });

  it("refuses to send a confirmation email when the origin is unconfigured", async () => {
    // The failure this prevents: production with no `NEXT_PUBLIC_APP_URL`
    // silently mailing every signup a link to a developer's laptop.
    appOrigin = null;
    const { state } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(authDouble.signUp).not.toHaveBeenCalled();
    expect(state?.message).toMatch(/not available/i);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("NEXT_PUBLIC_APP_URL")
    );
  });
});

describe("signUpWithEmailAction — confirmation disabled", () => {
  beforeEach(() => {
    // Supabase returns a session when email confirmation is off.
    authDouble.signUp.mockResolvedValue({
      data: { user: { id: "auth-1" }, session: { access_token: "t" } },
      error: null,
    });
    vi.mocked(viewer.getAuthIdentity).mockResolvedValue(identity());
  });

  it("projects the profile immediately", async () => {
    await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(viewer.syncSignedInProfile).toHaveBeenCalledTimes(1);
  });

  it("REDIRECTS rather than reporting a failure", async () => {
    /*
     * THE REGRESSION THIS BLOCK EXISTS FOR.
     *   `redirect()` throws. With the call inside the `try`, the catch swallowed
     *   `NEXT_REDIRECT` and returned "We could not reach our sign-in service" —
     *   the account existed, the session existed, and the person was told it
     *   failed. The suite distinguishes "no state returned" from "state
     *   returned", because returning a failure state after a successful
     *   sign-up is precisely the bug.
     */
    const { redirect, state } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
      next: "/search",
    });
    expect(redirect).toBe("/search");
    expect(state).toBeUndefined();
  });

  it("does not show the check-your-inbox copy when already signed in", async () => {
    const { state } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state).toBeUndefined();
  });

  it("honours a hostile next path no better than sign-in does", async () => {
    const { redirect } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
      next: "//evil.test",
    });
    expect(redirect).toBe("/");
  });
});

describe("signUpWithEmailAction — provider failure", () => {
  it("turns an already-registered address into sign-in guidance", async () => {
    authDouble.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });
    const { state } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state?.message).not.toMatch(/user already registered/i);
    expect(state?.message).toMatch(/sign in instead/i);
  });

  it("does not redirect when the address is taken", async () => {
    authDouble.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });
    const { redirect } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(redirect).toBeUndefined();
  });

  it("tells a throttled signup to wait rather than to check the inbox", async () => {
    // Supabase words a signup throttle as a confirmation email that was not
    // sent; "check your inbox" there sends the person somewhere useless.
    authDouble.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Too many requests: confirmation email not sent" },
    });
    const { state } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state?.message).toMatch(/wait|too many/i);
    expect(state?.message).not.toMatch(/inbox/i);
  });

  it("never leaks a provider constraint name", async () => {
    authDouble.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'duplicate key value violates unique constraint "auth_users_email_key"' },
    });
    const { state } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state?.message).not.toMatch(/auth_users_email_key|duplicate key/i);
  });

  it("survives a thrown transport error", async () => {
    authDouble.signUp.mockRejectedValue(new Error("socket hang up"));
    const { state } = await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state?.message).toMatch(/try again/i);
  });

  it("blocks signup when the deployment is unconfigured", async () => {
    configured.value = false;
    await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(authDouble.signUp).not.toHaveBeenCalled();
  });

  it("blocks signup when throttled", async () => {
    rateLimitAllowed.value = false;
    await run(actions.signUpWithEmailAction, {
      fullName: "Layla Hassan",
      email: "layla@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(authDouble.signUp).not.toHaveBeenCalled();
  });
});

describe("requestPasswordResetAction — enumeration safety", () => {
  const NEUTRAL = /if that email address has an account/i;

  beforeEach(() => {
    authDouble.resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it("gives the same answer for a registered address", async () => {
    const { state } = await run(actions.requestPasswordResetAction, {
      email: "layla@example.com",
    });
    expect(state?.message).toMatch(NEUTRAL);
  });

  it("gives the same answer when the provider reports no such user", async () => {
    // THE ENTUMERATION ORACLE. Supabase's own wording here varies by version;
    // whatever it says, the response must not vary.
    authDouble.resetPasswordForEmail.mockResolvedValue({
      error: { message: "User not found" },
    });
    const { state } = await run(actions.requestPasswordResetAction, {
      email: "ghost@example.com",
    });
    expect(state?.message).toMatch(NEUTRAL);
    expect(state?.message).not.toMatch(/no account|not found|unknown email/i);
  });

  it("gives the same answer on a provider outage", async () => {
    authDouble.resetPasswordForEmail.mockRejectedValue(new Error("ECONNREFUSED"));
    const { state } = await run(actions.requestPasswordResetAction, {
      email: "layla@example.com",
    });
    expect(state?.message).toMatch(NEUTRAL);
  });

  it("gives the same answer when throttled", async () => {
    rateLimitAllowed.value = false;
    const { state } = await run(actions.requestPasswordResetAction, {
      email: "layla@example.com",
    });
    expect(state?.message).toMatch(NEUTRAL);
  });

  it("keeps ok true in every one of those cases", async () => {
    // `ok` is part of the response too. Flipping it on failure would re-open the
    // oracle that the neutral wording closes.
    authDouble.resetPasswordForEmail.mockResolvedValue({
      error: { message: "User not found" },
    });
    const { state } = (await run(actions.requestPasswordResetAction, {
      email: "ghost@example.com",
    })) as { state: { ok: boolean } };
    expect(state.ok).toBe(true);
  });

  it("still asks the provider for a real address, so a real email really goes out", async () => {
    // Neutral in the response must not mean "skip the send" — that would break
    // recovery for legitimate users to protect a non-existent threat.
    await run(actions.requestPasswordResetAction, { email: "layla@example.com" });
    expect(authDouble.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it("logs provider failures without surfacing them", async () => {
    authDouble.resetPasswordForEmail.mockResolvedValue({
      error: { message: "smtp unavailable" },
    });
    await run(actions.requestPasswordResetAction, { email: "layla@example.com" });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[auth]"),
      "smtp unavailable"
    );
  });

  it("rejects a malformed address before the provider is consulted", async () => {
    const { state } = await run(actions.requestPasswordResetAction, { email: "nope" });
    expect(authDouble.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(state?.message).toMatch(/valid email/i);
  });

  it("never redirects — a redirect would leak the outcome via the URL bar", async () => {
    const { redirect } = await run(actions.requestPasswordResetAction, {
      email: "layla@example.com",
    });
    expect(redirect).toBeUndefined();
  });

  it("uses its own limiter namespace", async () => {
    await run(actions.requestPasswordResetAction, { email: "layla@example.com" });
    expect(vi.mocked(checkRateLimit).mock.calls.at(-1)?.[0]).toMatch(/^reset-request:/);
  });
});

describe("requestPasswordResetAction — recovery link destination", () => {
  beforeEach(() => {
    authDouble.resetPasswordForEmail.mockResolvedValue({ error: null });
  });

async function redirectTo(): Promise<string> {
    await run(actions.requestPasswordResetAction, { email: "layla@example.com" });
    // `resetPasswordForEmail(email, options)` — the options are the SECOND
    // argument, so this indexes the args tuple at 1.
    const options = authDouble.resetPasswordForEmail.mock.calls.at(-1)?.[1] as
      | { redirectTo: string }
      | undefined;
    return options?.redirectTo as string;
  }

  it("routes through the PKCE callback, not straight to the form", async () => {
    /*
     * THE BUG THIS BLOCK EXISTS FOR.
     *   A `redirectTo` of `/reset-password` delivers the one-time recovery code
     *   to a page that never calls `exchangeCodeForSession()`. No cookies are
     *   written, no recovery session exists, and `updateUser` fails for every
     *   person who follows a perfectly valid link. The callback is the only
     *   route that turns a code into a session.
     */
    expect(await redirectTo()).toBe(
      "http://localhost:3000/auth/callback?next=%2Freset-password"
    );
  });

  it("targets /reset-password as the eventual destination", async () => {
    expect(await redirectTo()).toContain(encodeURIComponent("/reset-password"));
  });

  it("addresses localhost in local development", async () => {
    expect(await redirectTo()).not.toMatch(/vercel\.app/);
  });

  it("addresses the deployment in production", async () => {
    appOrigin = "https://search-uae-business-activity.vercel.app";
    expect(await redirectTo()).toBe(
      "https://search-uae-business-activity.vercel.app/auth/callback?next=%2Freset-password"
    );
  });

  it("never addresses localhost in production", async () => {
    appOrigin = "https://search-uae-business-activity.vercel.app";
    expect(await redirectTo()).not.toMatch(/localhost/);
  });

  it("refuses to send a reset email when the origin is unconfigured", async () => {
    appOrigin = null;
    await run(actions.requestPasswordResetAction, { email: "layla@example.com" });
    expect(authDouble.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("NEXT_PUBLIC_APP_URL")
    );
  });

  it("stays neutral even when the origin is unconfigured", async () => {
    // A deployment misconfiguration is not a fact about this address.
    appOrigin = null;
    const { state } = await run(actions.requestPasswordResetAction, {
      email: "layla@example.com",
    });
    expect(state?.message).toMatch(/if that email address has an account/i);
  });
});

describe("updatePasswordAction — recovery session required", () => {
  beforeEach(() => {
    authDouble.updateUser.mockResolvedValue({ error: null, data: {} });
    vi.mocked(viewer.getAuthIdentity).mockResolvedValue(null);
  });

  it("checks for a session before touching the password", async () => {
    /*
     * The ordering is the authorization. `updateUser` is only reached after
     * `getUser` proves a recovery session exists, so there is no window in which
     * a request without one can attempt a change.
     */
    const order: string[] = [];
    authDouble.getUser.mockImplementation(async () => {
      order.push("session-check");
      return { data: { user: { id: "auth-1" } }, error: null };
    });
    authDouble.updateUser.mockImplementation(async () => {
      order.push("update");
      return { error: null, data: {} };
    });

    await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(order).toEqual(["session-check", "update"]);
  });

  it("reports an expired or used link instead of a confusing provider error", async () => {
    authDouble.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Auth session missing" },
    });
    const { state } = await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state?.message).toMatch(/expired|already been used/i);
    expect(authDouble.updateUser).not.toHaveBeenCalled();
  });

  it("treats a null user as no session", async () => {
    authDouble.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { state } = await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state?.message).toMatch(/expired|already been used/i);
    expect(authDouble.updateUser).not.toHaveBeenCalled();
  });

  it("does not redirect when there is no session", async () => {
    authDouble.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { redirect } = await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(redirect).toBeUndefined();
  });

  it("changes only the password — no identity field is forwarded", async () => {
    authDouble.getUser.mockResolvedValue({
      data: { user: { id: "auth-1" } },
      error: null,
    });
    await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    // The account is the session's account. Accepting an id or email here would
    // turn the form into a "change anyone's password" endpoint.
    expect(authDouble.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(Object.keys(authDouble.updateUser.mock.calls.at(-1)?.[0] as object)).toEqual([
      "password",
    ]);
  });

  it("ignores a payload naming another account", async () => {
    /*
     * The account is the recovery session's account. A posted `email` or
     * `authUserId` is simply not among the fields the action reads, so it cannot
     * retarget the change — this is what keeps the form from becoming a
     * "change anyone's password" endpoint.
     */
    authDouble.getUser.mockResolvedValue({
      data: { user: { id: "auth-1" } },
      error: null,
    });
    const data = form({ password: PASSWORD, confirmPassword: PASSWORD });
    data.append("email", "victim@example.com");
    data.append("authUserId", "someone-else");

    await runForm(actions.updatePasswordAction, data);

    expect(authDouble.updateUser).toHaveBeenCalledTimes(1);
    // Only the session's own user is affected, and only the password is sent.
    expect(Object.keys(authDouble.updateUser.mock.calls.at(-1)?.[0] as object)).toEqual([
      "password",
    ]);
  });

  it("rejects a mismatch before checking anything", async () => {
    const { state } = await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: "different1",
    });
    expect(authDouble.getUser).not.toHaveBeenCalled();
    expect(state?.message).toMatch(/do not match/i);
  });

  it("rejects a weak new password before checking anything", async () => {
    const { state } = await run(actions.updatePasswordAction, {
      password: "abc",
      confirmPassword: "abc",
    });
    expect(authDouble.getUser).not.toHaveBeenCalled();
    expect(state?.message).toMatch(/at least/i);
  });

  it("returns no password in any failure state", async () => {
    authDouble.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Auth session missing" },
    });
    const { state } = await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(JSON.stringify(state)).not.toContain(PASSWORD);
  });
});

describe("updatePasswordAction — success", () => {
  beforeEach(() => {
    authDouble.getUser.mockResolvedValue({
      data: { user: { id: "auth-1" } },
      error: null,
    });
    authDouble.updateUser.mockResolvedValue({ error: null, data: {} });
    vi.mocked(viewer.getAuthIdentity).mockResolvedValue(null);
  });

  it("redirects to the account page, so the person is not asked to sign in again", async () => {
    // A recovery session's whole purpose was to change this password; bouncing
    // through the sign-in form would be a pointless extra step.
    const { redirect } = await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(redirect).toBe("/account");
  });

  it("returns no state on success, so no stale error is shown", async () => {
    const { state } = await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state).toBeUndefined();
  });

  it("stamps the sign-in the same way every other entry point does", async () => {
    vi.mocked(viewer.getAuthIdentity).mockResolvedValue(identity());
    await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    // Changing a password is a credential change; `lastLoginAt` and the profile
    // row must not diverge based on which door the person came through.
    expect(viewer.syncSignedInProfile).toHaveBeenCalledTimes(1);
  });
});

describe("updatePasswordAction — provider failure", () => {
  beforeEach(() => {
    authDouble.getUser.mockResolvedValue({
      data: { user: { id: "auth-1" } },
      error: null,
    });
    vi.mocked(viewer.getAuthIdentity).mockResolvedValue(null);
  });

  it("returns safe copy when the provider rejects the new password", async () => {
    authDouble.updateUser.mockResolvedValue({
      error: { message: "Password should be at least 8 characters" },
    });
    const { state } = await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state?.message).not.toMatch(/password should be at least/i);
    expect(state?.message).toMatch(/requirements/i);
  });

  it("reports an expired session that expires mid-flight", async () => {
    // The session can be invalidated between the check and the update; the copy
    // must point at requesting a new link rather than at the password policy.
    authDouble.updateUser.mockResolvedValue({
      error: { message: "Auth session missing" },
    });
    const { state } = await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state?.message).toMatch(/expired|already been used/i);
  });

  it("does not redirect when the change failed", async () => {
    authDouble.updateUser.mockResolvedValue({ error: { message: "weak password" } });
    const { redirect } = await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(redirect).toBeUndefined();
  });

  it("survives a thrown transport error", async () => {
    authDouble.updateUser.mockRejectedValue(new Error("ECONNRESET"));
    const { state } = await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(state?.message).toMatch(/try again/i);
  });

  it("blocks the change when the deployment is unconfigured", async () => {
    configured.value = false;
    await run(actions.updatePasswordAction, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(authDouble.updateUser).not.toHaveBeenCalled();
  });
});

describe("the \"use server\" module only exports async functions", () => {
  it("exports no non-function value that Next would reject at build time", async () => {
    /*
     * A top-level `"use server"` file may export async functions only. The
     * initial state used to be exported from here, which `tsc` accepted and
     * `next build` rejected — so this is asserted rather than assumed.
     */
    const moduleExports = await import("@/app/(public)/auth/actions");
    for (const [name, value] of Object.entries(moduleExports)) {
      const kind = typeof value;
      expect(kind, `export "${name}" should be a function, got ${kind}`).toBe("function");
    }
  });

  it("exports the four flow actions and nothing else", async () => {
    const moduleExports = await import("@/app/(public)/auth/actions");
    expect(Object.keys(moduleExports).sort()).toEqual([
      "requestPasswordResetAction",
      "signInWithEmailAction",
      "signUpWithEmailAction",
      "updatePasswordAction",
    ]);
  });
});