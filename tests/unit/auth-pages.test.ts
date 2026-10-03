import { describe, it, expect, vi, beforeEach } from "vitest";
import { authState, resetAuth, signInAsUser } from "../helpers/auth-mock";
import { renderElement } from "../helpers/render";

/**
 * The four public auth pages, as server components.
 *
 * The forms themselves are covered in `auth-forms.test.ts`; they are stubbed out
 * here so these tests can concentrate on the routing and gating behaviour that
 * surrounds them and that no other suite reaches:
 *
 *   - an already-signed-in visitor is sent onward instead of being offered a
 *     form that would dead-end;
 *   - `?next=` is honoured when it is a same-origin path and dropped when it is
 *     not;
 *   - a deployment without Supabase configured says so rather than rendering a
 *     form that cannot possibly work;
 *   - the recovery page decides form-vs-expiry from a SERVER-side session read.
 *
 * These pages must also stay out of search results; each is a dead end without a
 * link, and the metadata is the only place that is expressed.
 */

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  redirect: vi.fn(),
  supabaseConfigured: true,
  sessionError: null as { message: string } | null,
  sessionUser: { id: "auth-1" } as { id: string } | null,
}));

vi.mock("next/navigation", () => ({
  redirect: state.redirect,
  notFound: vi.fn(),
}));

vi.mock("@/lib/auth/viewer", async () => {
  const { authViewerMock } = await import("../helpers/auth-mock");
  return authViewerMock();
});

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => state.supabaseConfigured,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: state.sessionUser },
        error: state.sessionError,
      })),
    },
  })),
}));

/** The forms are covered elsewhere; here they render as nothing. */
vi.mock("@/components/auth/email-sign-in-form", () => ({
  EmailSignInForm: () => null,
}));
vi.mock("@/components/auth/email-sign-up-form", () => ({
  EmailSignUpForm: () => null,
}));
vi.mock("@/components/auth/forgot-password-form", () => ({
  ForgotPasswordForm: () => null,
}));
vi.mock("@/components/auth/reset-password-form", () => ({
  ResetPasswordForm: () => null,
}));

import SignInPage, { dynamic as signInDynamic, metadata as signInMetadata } from "@/app/(public)/signin/page";
import SignUpPage, { dynamic as signUpDynamic, metadata as signUpMetadata } from "@/app/(public)/signup/page";
import ForgotPasswordPage, { dynamic as forgotDynamic, metadata as forgotMetadata } from "@/app/(public)/forgot-password/page";
import ResetPasswordPage, { dynamic as resetDynamic, metadata as resetMetadata } from "@/app/(public)/reset-password/page";

/**
 * The walker concatenates JSX text nodes verbatim, so a phrase broken across
 * lines arrives as `storesonly`. Collapsing runs of whitespace first is what
 * makes ordinary sentence fragments usable as assertions.
 */
async function textOf(element: unknown): Promise<string> {
  const view = await renderElement(element);
  return view.text.replace(/\s+/g, " ");
}

async function hrefsOf(element: unknown): Promise<string[]> {
  const view = await renderElement(element);
  return view.hrefs;
}

/** `redirect()` throws in Next; the mock must too, or the branch is not proven. */
beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  state.supabaseConfigured = true;
  state.sessionUser = { id: "auth-1" };
  state.sessionError = null;
  state.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

describe("auth pages keep themselves out of search results", () => {
  const pages = [
    ["/signin", signInMetadata],
    ["/signup", signUpMetadata],
    ["/forgot-password", forgotMetadata],
    ["/reset-password", resetMetadata],
  ] as const;

  it.each(pages)("%s asks not to be indexed", (_path, metadata) => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

// Each page reads the session cookie, so a statically cached copy would serve
  // one visitor another visitor's page.
  it("renders all four dynamically", () => {
    expect([
      signInDynamic,
      signUpDynamic,
      forgotDynamic,
      resetDynamic,
    ]).toEqual([
      "force-dynamic",
      "force-dynamic",
      "force-dynamic",
      "force-dynamic",
    ]);
  });
});

describe("/signin", () => {
  const page = (params: Record<string, string> = {}) =>
    SignInPage({ searchParams: Promise.resolve(params) });

  it("renders for an anonymous visitor", async () => {
    expect(await textOf(await page())).toMatch(/^Sign in/);
  });

  it("serves the form itself when configured, so there is no signup link yet", async () => {
    // Nothing to link to while sign-up genuinely does not work; a link would be
    // a promise the deployment cannot keep.
    expect(await hrefsOf(await page())).not.toContain("/signup");
  });

  it("points an unconfigured deployment at account creation", async () => {
    state.supabaseConfigured = false;
    expect(await hrefsOf(await page())).toContain("/signup");
  });

  it("sends an already-signed-in visitor to the root by default", async () => {
    signInAsUser();
    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("sends an already-signed-in visitor onward through a same-origin next", async () => {
    signInAsUser();
    await expect(page({ next: "/account/profile" })).rejects.toThrow(
      "NEXT_REDIRECT:/account/profile"
    );
  });

  it("discards an off-origin next rather than redirecting to it", async () => {
    // An open redirect at the front door of the app: the session cookie would be
    // followed by the attacker's site, which then sees the referrer.
    signInAsUser();
    await expect(page({ next: "https://evil.example/steal" })).rejects.toThrow(
      "NEXT_REDIRECT:/"
    );
  });

  it("shows the configured-deployment message when Supabase is absent", async () => {
    state.supabaseConfigured = false;
    const text = await textOf(await page());
    expect(text).toMatch(/Sign-in has not been configured/i);
  });

  it("explains a recognised failure carried back from the callback", async () => {
    expect(await textOf(await page({ error: "missing_code" }))).toMatch(
      /incomplete or already used/i
    );
  });

  it("falls back to generic copy for an unrecognised error", async () => {
    const text = await textOf(await page({ error: "not_a_real_code" }));
    expect(text).toMatch(/couldn’t complete the sign-in/i);
  });

  it("never reflects an arbitrary error value into the page", async () => {
    // A reflected `?error=` value is a reflected-XSS surface.
    const text = await textOf(await page({ error: "<script>alert(1)</script>" }));
    expect(text).not.toMatch(/<script>/i);
  });
});

describe("/signup", () => {
  const page = (params: Record<string, string> = {}) =>
    SignUpPage({ searchParams: Promise.resolve(params) });

  it("renders for an anonymous visitor", async () => {
    expect(await textOf(await page())).toMatch(/Create account/);
  });

  it("states that the password is not kept in this application's database", async () => {
    // The question people have at exactly this point, answered before they ask.
    expect(await textOf(await page())).toMatch(
      /stores only your name, email address and profile picture/i
    );
  });

  it("sends an already-signed-in visitor onward instead of offering signup", async () => {
    signInAsUser();
    await expect(page({ next: "/search" })).rejects.toThrow("NEXT_REDIRECT:/search");
  });

  it("sends an already-signed-in visitor to the root when next is off-origin", async () => {
    signInAsUser();
    await expect(page({ next: "//evil.example" })).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("shows the configured-deployment message when Supabase is absent", async () => {
    state.supabaseConfigured = false;
    expect(await textOf(await page())).toMatch(
      /Account creation has not been configured/i
    );
  });
});

describe("/forgot-password", () => {
  it("renders for an anonymous visitor", async () => {
    expect(await textOf(await ForgotPasswordPage())).toMatch(/Forgot password/);
  });

  it("promises a link without confirming the address exists", async () => {
    // Enumeration safety starts with the copy: this sentence must not vary
    // between a registered address and an unknown one.
    expect(await textOf(await ForgotPasswordPage())).toMatch(
      /we will send you a link to set a new password/i
    );
  });

  it("sends a signed-in visitor to their account instead", async () => {
    // There is nothing to recover to when you already hold a session.
    signInAsUser();
    await expect(ForgotPasswordPage()).rejects.toThrow("NEXT_REDIRECT:/account");
  });

  it("stays reachable with no session at all, which is the whole point", async () => {
    authState.viewer = null;
    expect(await textOf(await ForgotPasswordPage())).toMatch(/Forgot password/);
  });

  it("shows the configured-deployment message when Supabase is absent", async () => {
    state.supabaseConfigured = false;
    expect(await textOf(await ForgotPasswordPage())).toMatch(
      /Password reset has not been configured/i
    );
  });
});

describe("/reset-password", () => {
  it("offers the form when a recovery session is present", async () => {
    // A recovery session exists WITHOUT a normal signed-in viewer — that is
    // precisely the state this page has to work in, so the viewer is left null.
    authState.viewer = null;
    expect(await textOf(await ResetPasswordPage())).toMatch(
      /Choose a new password for your account/i
    );
  });

  it("tells the person to open the link when no session is present", async () => {
    authState.viewer = null;
    state.sessionUser = null;
    state.sessionError = { message: "Auth session missing" };
    expect(await textOf(await ResetPasswordPage())).toMatch(
      /Open the link from your reset email/i
    );
  });

  it("degrades to the safe message when the session check throws", async () => {
    // A transport failure must not render as though no session exists in the
    // sense of blaming the person; it renders the actionable copy instead.
    authState.viewer = null;
    state.sessionUser = null;
    state.sessionError = { message: "boom" };
    expect(await textOf(await ResetPasswordPage())).toMatch(
      /Open the link from your reset email/i
    );
  });

  it("never names a host of its own", async () => {
    // The emailed link's origin comes from the reset request; this page must not
    // need to know it and must not carry a hardcoded one.
    const text = await textOf(await ResetPasswordPage());
    expect(text).not.toMatch(/vercel\.app|localhost/i);
  });

  it("states that the password is never stored in this application's database", async () => {
    expect(await textOf(await ResetPasswordPage())).toMatch(
      /never stored in this application/i
    );
  });
});