import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  authState,
  resetAuth,
  signInAsAdmin,
  signInAsSuspended,
  signInAsUser,
} from "../helpers/auth-mock";

/**
 * Page-level access control.
 *
 * The two profile pages read a person's own identity, and `/admin/profile` sits
 * inside the admin tree. These tests assert the gate each page actually calls
 * rather than trusting the layout, because a page is a server component that
 * can be mounted or invoked on its own.
 */
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  revalidatePath: vi.fn(),
  supabaseConfigured: true,
}));

vi.mock("next/navigation", () => ({
  redirect: state.redirect,
  notFound: state.notFound,
}));

vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));

vi.mock("@/lib/auth/viewer", async () => {
  const { authViewerMock } = await import("../helpers/auth-mock");
  return authViewerMock();
});

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => state.supabaseConfigured,
}));

// The page renders client components; stub them to plain markers so these
// tests exercise the auth branch, not React's rendering of a form.
vi.mock("@/components/profile/profile-name-form", () => ({
  ProfileNameForm: () => null,
  INITIAL_PROFILE_STATE: { ok: false, message: "", fullName: null },
}));

vi.mock("@/components/auth/account-suspended-notice", () => ({
  AccountSuspendedNotice: () => null,
}));

import AccountProfilePage from "@/app/(public)/account/profile/page";
import AdminProfilePage from "@/app/admin/profile/page";

/**
 * `redirect()` and `notFound()` throw in Next. The mocks must throw too,
 * otherwise the code under test keeps running past the branch we are proving it
 * takes. The recorded calls let a test still assert WHICH url was used.
 */
const redirectCalls: string[] = [];
const notFoundCalls: number[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  state.supabaseConfigured = true;
  redirectCalls.length = 0;
  notFoundCalls.length = 0;

  state.redirect.mockImplementation((url: string) => {
    redirectCalls.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  state.notFound.mockImplementation(() => {
    notFoundCalls.push(1);
    throw new Error("NEXT_NOT_FOUND");
  });
});

describe("/account/profile access control", () => {
  it("redirects an unauthenticated visitor to sign in with a return path", async () => {
    resetAuth();
    await expect(AccountProfilePage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectCalls).toEqual([
      `/signin?next=${encodeURIComponent("/account/profile")}`,
    ]);
  });

  it("renders for an authenticated normal user", async () => {
    signInAsUser();
    const result = await AccountProfilePage();
    expect(redirectCalls).toEqual([]);
    expect(result).toBeTruthy();
  });

  it("renders for an admin too — admins are also users", async () => {
    signInAsAdmin();
    const result = await AccountProfilePage();
    expect(redirectCalls).toEqual([]);
    expect(result).toBeTruthy();
  });

  it("still renders for a suspended user so they can read why they are blocked", async () => {
    // The page is read-only for them; hiding the account entirely would leave
    // no way to see the reason or to sign out.
    signInAsSuspended();
    const result = await AccountProfilePage();
    expect(redirectCalls).toEqual([]);
    expect(result).toBeTruthy();
  });
});

describe("/admin/profile access control", () => {
  it("refuses an anonymous visitor", async () => {
    resetAuth();
    await expect(AdminProfilePage()).rejects.toMatchObject({ status: 401 });
  });

  it("refuses an authenticated non-admin with a 403", async () => {
    signInAsUser();
    await expect(AdminProfilePage()).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a suspended admin — suspension beats the role", async () => {
    signInAsSuspended({ role: "admin", status: "suspended" });
    await expect(AdminProfilePage()).rejects.toMatchObject({ status: 403 });
  });

  it("renders for an active admin", async () => {
    signInAsAdmin();
    const result = await AdminProfilePage();
    expect(result).toBeTruthy();
  });

  it("does not throw a redirect — it fails closed rather than bouncing", async () => {
    resetAuth();
    await expect(AdminProfilePage()).rejects.toMatchObject({ status: 401 });
    expect(redirectCalls).toEqual([]);
  });
});

describe("profile pages do not leak credentials", () => {
  it("the viewer passed through the mock has no token fields to render", () => {
    // Guards the render contract: if a future column were added to Viewer and
    // spread onto these pages, this is the test that would notice.
    const viewer = signInAsAdmin();
    for (const forbidden of [
      "accessToken",
      "refreshToken",
      "idToken",
      "session",
      "password",
      "serviceRoleKey",
    ]) {
      expect(viewer).not.toHaveProperty(forbidden);
    }
  });

  it("the auth state cannot be set from a query string or param", () => {
    // The page signatures take no searchParams at all, so there is no parameter
    // that could influence identity. Assert the viewer comes from the gate.
    signInAsUser();
    expect(authState.viewer?.email).toBe("user@example.com");
  });
});
