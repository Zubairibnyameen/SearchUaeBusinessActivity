import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";

import {
  resetAuth,
  signInAsAdmin,
  signInAsSuspended,
  signInAsUser,
} from "../helpers/auth-mock";
import { renderElement } from "../helpers/render";

/**
 * The `/account` dashboard.
 *
 * The page is a server component whose entire security surface is "who does
 * `getViewer()` return". These tests pin that: anonymous is redirected, every
 * signed-in role sees only its OWN row, a suspended account is shown a
 * dashboard with its capabilities withdrawn, and nothing in the output reveals a
 * provider-internal id or offers a privilege control.
 */
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  redirect: vi.fn(),
  supabaseConfigured: true,
  signOutCalls: 0,
}));

const redirectCalls: string[] = [];

vi.mock("next/navigation", () => ({ redirect: state.redirect }));

// Rendered as a plain anchor: the real `next/link` is a memo/forwardRef
// component that needs a router context this test does not provide, and the
// href is the part that matters here.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("@/lib/auth/viewer", async () => {
  const { authViewerMock } = await import("../helpers/auth-mock");
  return authViewerMock();
});

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => state.supabaseConfigured,
}));

vi.mock("@/app/(public)/account/actions", () => ({
  signOutAction: async () => {
    state.signOutCalls += 1;
  },
}));

// The dashboard is a server component; rendering the real tree is covered by
// the build and the component tests. Here we only need the auth branch and the
// props the page hands down, so the child components are instrumented spies.
const captured = vi.hoisted(() => ({
  identity: null as Record<string, unknown> | null,
  quickActions: null as Record<string, unknown> | null,
  usage: null as Record<string, unknown> | null,
  signOutRendered: false,
  googleSignInRendered: false,
  searchCounts: null as { total: number; last30Days: number } | null,
  searchCountsCalls: 0,
  searchCountsViewers: [] as unknown[],
}));

/**
 * The count read is stubbed rather than allowed to reach a database, so these
 * tests exercise the page's branch logic deterministically. `searchCounts` is
 * `null` by default, which is the page's "could not read" input.
 */
vi.mock("@/lib/auth/search-usage", () => ({
  getSearchUsageCountsSafely: async (viewer: unknown) => {
    captured.searchCountsCalls += 1;
    captured.searchCountsViewers.push(viewer);
    return captured.searchCounts;
  },
}));

vi.mock("@/components/account/account-dashboard", () => ({
  AccountIdentityCard: (props: Record<string, unknown>) => {
    captured.identity = props;
    return null;
  },
  AccountUsageCard: (props: Record<string, unknown>) => {
    captured.usage = props;
    return null;
  },
  AccountQuickActions: (props: Record<string, unknown>) => {
    captured.quickActions = props;
    return null;
  },
  SignOutCard: () => {
    captured.signOutRendered = true;
    return null;
  },
}));

vi.mock("@/components/auth/google-sign-in-button", () => ({
  GoogleSignInButton: () => {
    captured.googleSignInRendered = true;
    return null;
  },
}));

import AccountPage from "@/app/(public)/account/page";

/**
 * The page is an async server component: calling it only builds the root
 * element. The mocked children are invoked while the tree is walked, which is
 * what populates `captured`, so every render assertion goes through here.
 */
async function renderAccount() {
  return renderElement(await AccountPage());
}

/** `redirect()` throws in Next; the mock must too or the branch is not proven. */
beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  state.supabaseConfigured = true;
  state.signOutCalls = 0;
  redirectCalls.length = 0;
  captured.identity = null;
  captured.quickActions = null;
  captured.usage = null;
  captured.signOutRendered = false;
  captured.googleSignInRendered = false;
  captured.searchCounts = null;
  captured.searchCountsCalls = 0;
  captured.searchCountsViewers = [];

  state.redirect.mockImplementation((url: string) => {
    redirectCalls.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Anonymous access is redirected
// ─────────────────────────────────────────────────────────────────────────────

describe("/account — anonymous access", () => {
  it("redirects to sign in and preserves the return path", async () => {
    resetAuth();
    await expect(AccountPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectCalls).toEqual([`/signin?next=${encodeURIComponent("/account")}`]);
  });

  it("renders no identity card for an anonymous visitor", async () => {
    resetAuth();
    await AccountPage().catch(() => undefined);
    expect(captured.identity).toBeNull();
    expect(captured.signOutRendered).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Authenticated user sees their OWN account information
// ─────────────────────────────────────────────────────────────────────────────

describe("/account — authenticated user", () => {
  it("renders for a signed-in normal user", async () => {
    signInAsUser();
    const { text } = await renderAccount();
    expect(redirectCalls).toEqual([]);
    expect(text.length).toBeGreaterThan(0);
    expect(captured.identity).not.toBeNull();
  });

  it("passes the caller's own name and email to the identity card", async () => {
    signInAsUser({ fullName: "Layla Hassan", email: "layla@example.com" });
    await renderAccount();

    const profile = captured.identity?.profile as Record<string, unknown>;
    expect(profile.fullName).toBe("Layla Hassan");
    expect(profile.email).toBe("layla@example.com");
    expect(profile.role).toBe("user");
    expect(profile.status).toBe("active");
    expect(profile.createdAt).toBeInstanceOf(Date);
    expect(profile.lastLoginAt).toBeInstanceOf(Date);
  });

  it("renders an admin's own record too — admins are users first", async () => {
    signInAsAdmin();
    await renderAccount();
    const profile = captured.identity?.profile as Record<string, unknown>;
    expect(profile.role).toBe("admin");
  });

  it("reads the counts exactly once per render", async () => {
    signInAsUser();
    await renderAccount();
    expect(captured.searchCountsCalls).toBe(1);
  });

  it("asks for the signed-in viewer's own counts, not a passed-in id", async () => {
    signInAsUser({ id: "app-user-77" });
    await renderAccount();

    // The page hands the DAL the viewer and nothing else, so the row scope is
    // decided by the verified session rather than by the page.
    const [viewer] = captured.searchCountsViewers as Array<{ id: string }>;
    expect(viewer.id).toBe("app-user-77");
  });

  it("passes real counts straight through to the usage card", async () => {
    signInAsUser();
    captured.searchCounts = { total: 128, last30Days: 17 };
    await renderAccount();

    const usage = captured.usage?.usage as {
      searches: { available: boolean; total: number; last30Days: number };
    };
    expect(usage.searches.available).toBe(true);
    expect(usage.searches.total).toBe(128);
    expect(usage.searches.last30Days).toBe(17);
  });

  it("distinguishes a real zero from an unreadable count", async () => {
    signInAsUser();
    captured.searchCounts = { total: 0, last30Days: 0 };
    await renderAccount();

    const usage = captured.usage?.usage as { searches: { available: boolean } };
    expect(usage.searches.available).toBe(true);
  });

  it("falls back to unavailable when the read fails", async () => {
    signInAsUser();
    captured.searchCounts = null;
    await renderAccount();

    const usage = captured.usage?.usage as { searches: { available: boolean } };
    expect(usage.searches.available).toBe(false);
  });

  it("shows a search-usage empty state rather than a fabricated count", async () => {
    signInAsUser();
    await renderAccount();
    const usage = captured.usage?.usage as {
      searches: { available: boolean };
      profile: { percentComplete: number };
    };
    expect(usage.searches.available).toBe(false);
    expect(usage.profile.percentComplete).toBeTypeOf("number");
  });

  it("enables the search and profile-edit quick actions for an active account", async () => {
    signInAsUser();
    await renderAccount();
    expect(captured.quickActions?.canSearch).toBe(true);
    expect(captured.quickActions?.canEditProfile).toBe(true);
    expect(captured.quickActions?.isAdmin).toBe(false);
  });

  it("offers the admin dashboard only to admins", async () => {
    signInAsAdmin();
    await renderAccount();
    expect(captured.quickActions?.isAdmin).toBe(true);
  });

  it("always offers a sign-out control", async () => {
    signInAsUser();
    await renderAccount();
    expect(captured.signOutRendered).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Suspended user handling
// ─────────────────────────────────────────────────────────────────────────────

describe("/account — suspended user", () => {
  it("still renders the dashboard so they can see why and sign out", async () => {
    signInAsSuspended();
    const { text } = await renderAccount();
    expect(redirectCalls).toEqual([]);
    expect(text.length).toBeGreaterThan(0);
    expect(captured.identity).not.toBeNull();
  });

  it("reports the account as suspended", async () => {
    signInAsSuspended();
    await renderAccount();
    const profile = captured.identity?.profile as Record<string, unknown>;
    expect(profile.status).toBe("suspended");
  });

  it("withdraws the search capability instead of offering a dead link", async () => {
    signInAsSuspended();
    await renderAccount();
    // The page renders, but the quick action is disabled: following it would
    // land on a requireViewer() 403, which is a worse experience than saying so.
    expect(captured.quickActions?.canSearch).toBe(false);
  });

  it("withdraws profile editing, which /account/profile also locks", async () => {
    signInAsSuspended();
    await renderAccount();
    expect(captured.quickActions?.canEditProfile).toBe(false);
  });

  it("keeps the profile and sign-out paths available", async () => {
    signInAsSuspended();
    await renderAccount();
    // Only the gated capabilities go. Reviewing one's own details is not a
    // privilege, and sign-out must never be blocked.
    expect(captured.signOutRendered).toBe(true);
  });

  it("still shows the account's own search history", async () => {
    signInAsSuspended();
    captured.searchCounts = { total: 42, last30Days: 3 };
    await renderAccount();

    // Suspension stops new rows being written; it does not erase or hide the
    // ones that already exist. The data is the user's own and was earned
    // while the account was active.
    const usage = captured.usage?.usage as {
      searches: { available: boolean; total: number; last30Days: number };
    };
    expect(usage.searches.available).toBe(true);
    expect(usage.searches.total).toBe(42);
    expect(usage.searches.last30Days).toBe(3);
  });

  it("treats a suspended admin as a non-admin for capabilities", async () => {
    signInAsSuspended({ role: "admin" });
    await renderAccount();
    expect(captured.quickActions?.canSearch).toBe(false);
    expect(captured.quickActions?.canEditProfile).toBe(false);
    expect(captured.quickActions?.isAdmin).toBe(false);
  });

  it("still surfaces the signed-in identity, never a sign-in prompt", async () => {
    signInAsSuspended();
    const { text } = await renderAccount();
    // Re-authenticating cannot lift a suspension, so the page must not send
    // them round the sign-in loop.
    expect(redirectCalls).toEqual([]);
    expect(text).not.toMatch(/sign in with another google account/i);
    expect(captured.googleSignInRendered).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. No privilege fields are exposed as editable
// ─────────────────────────────────────────────────────────────────────────────

describe("/account — privilege fields are read-only", () => {
  it("passes no mutation handler to any dashboard component", async () => {
    signInAsAdmin();
    await renderAccount();
    // The dashboard is view-only. The only action it wires up is signOutAction,
    // which is rendered by SignOutCard, and none of the props below may carry
    // a role/status write path.
    expect(captured.identity).not.toHaveProperty("onChangeRole");
    expect(captured.identity).not.toHaveProperty("onChangeStatus");
    expect(captured.identity).not.toHaveProperty("action");
    expect(captured.quickActions).not.toHaveProperty("action");
    expect(captured.usage).not.toHaveProperty("action");
  });

  it("role and status are passed as plain values, never as editable state", async () => {
    signInAsUser({ role: "user", status: "active" });
    await renderAccount();
    const profile = captured.identity?.profile as Record<string, unknown>;
    expect(profile.role).toBe("user");
    expect(profile.status).toBe("active");
    expect(typeof profile.role).toBe("string");
    expect(typeof profile.status).toBe("string");
  });

  it("the usage payload contains no role or status write affordance", async () => {
    signInAsUser();
    await renderAccount();
    const usage = captured.usage?.usage as Record<string, unknown>;
    expect(usage).not.toHaveProperty("updateRole");
    expect(usage).not.toHaveProperty("updateStatus");
  });

  it("renders no form control on the page itself", async () => {
    signInAsUser();
    const { tags } = await renderAccount();
    // The dashboard is a read-only view; editing happens on /account/profile
    // and admin changes on /admin/users. Only SignOutCard may post a form.
    expect(tags).not.toContain("input");
    expect(tags).not.toContain("select");
    expect(tags).not.toContain("textarea");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. No client-controlled user id is used
// ─────────────────────────────────────────────────────────────────────────────

describe("/account — no client-controlled identity", () => {
  it("the page component takes no parameters at all", () => {
    // This is the structural guarantee: with no `params`, no `searchParams` and
    // no body, there is no request-supplied value that could select a record.
    expect(AccountPage.length).toBe(0);
  });

  it("does not forward the viewer's internal ids to any component", async () => {
    signInAsUser();
    await renderAccount();

    const profile = captured.identity?.profile as Record<string, unknown>;
    expect(profile).not.toHaveProperty("id");
    expect(profile).not.toHaveProperty("authUserId");
    expect(profile).not.toHaveProperty("providerUserId");
  });

  it("never leaks the provider id into any captured prop tree", async () => {
    const viewer = signInAsUser();
    await renderAccount();

    const serialised = JSON.stringify({
      identity: captured.identity,
      usage: captured.usage,
      quickActions: captured.quickActions,
    });
    expect(serialised).not.toContain(viewer.authUserId);
    expect(serialised).not.toContain(viewer.id);
  });

  it("reads identity from the session, not from the request", async () => {
    const viewer = signInAsUser();
    await renderAccount();
    // The only identity the page can render is the one `getViewer()` resolved
    // from the verified session cookie.
    const profile = captured.identity?.profile as Record<string, unknown>;
    expect(profile.email).toBe(viewer.email);
    expect(profile.email).toBe("user@example.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Existing profile links still work
// ─────────────────────────────────────────────────────────────────────────────

describe("/account — profile link", () => {
  it("still renders the page without a Supabase configuration", async () => {
    state.supabaseConfigured = false;
    signInAsUser();
    const { text } = await renderAccount();
    expect(text.length).toBeGreaterThan(0);
  });

  it("still renders a suspended account without a Supabase configuration", async () => {
    state.supabaseConfigured = false;
    signInAsSuspended();
    const { text } = await renderAccount();
    expect(text.length).toBeGreaterThan(0);
  });

  it("the dashboard does not redirect an active user when config is missing", async () => {
    state.supabaseConfigured = false;
    signInAsUser();
    await renderAccount();
    expect(redirectCalls).toEqual([]);
  });

  it("withholds profile editing when sign-in is not configured", async () => {
    // The profile page gates its form on the same condition, so the dashboard
    // tile must not promise an edit that cannot be saved.
    state.supabaseConfigured = false;
    signInAsUser();
    await renderAccount();
    expect(captured.quickActions?.canEditProfile).toBe(false);
  });

  it("links onward to the profile page", async () => {
    signInAsUser();
    const { text, hrefs } = await renderAccount();
    // The quick action lives in the child component; the page keeps the inline
    // explanation link so the read-only boundary is stated in words too.
    expect(text).toMatch(/display name is the only field you can change/i);
    expect(text).toMatch(/profile page/i);
    expect(hrefs).toContain("/account/profile");
  });

  it("states in words who owns each protected field", async () => {
    signInAsUser();
    const { text } = await renderAccount();
    expect(text).toMatch(/email and profile picture belong to Google/i);
    expect(text).toMatch(/role and account status are assigned by an administrator/i);
  });

  it("offers a way to switch Google account for an active user", async () => {
    signInAsUser();
    const { text } = await renderAccount();
    expect(captured.googleSignInRendered).toBe(true);
    expect(text).toMatch(/sign in with another google account/i);
  });

  it("reassures that no credentials are rendered or sent to the browser", async () => {
    signInAsUser();
    const { text } = await renderAccount();
    expect(text).toMatch(/no authentication tokens, OAuth secrets or session credentials/i);
  });
});
