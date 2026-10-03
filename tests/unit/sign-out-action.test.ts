import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `signOutAction` — the sign-out control on `/account`.
 *
 * The dashboard suite proves a sign-out control is *rendered* on every account
 * state, including a suspended one. That is the affordance; this file is the
 * effect, which nothing covered: that the provider session is actually revoked
 * and that a failure is surfaced instead of being reported as a success.
 */
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  signOut: vi.fn(),
  clientFails: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    if (state.clientFails) throw new Error("no cookie store available");
    return { auth: { signOut: state.signOut } };
  },
}));

import { signOutAction } from "@/app/(public)/account/actions";

beforeEach(() => {
  vi.clearAllMocks();
  state.clientFails = false;
  state.signOut.mockResolvedValue({ error: null });
});

describe("signOutAction", () => {
  it("revokes the provider session", async () => {
    await signOutAction();
    expect(state.signOut).toHaveBeenCalledTimes(1);
  });

  it("resolves quietly on success, so the page can re-render signed out", async () => {
    // After the action the router revalidates `/account`, whose `getViewer()`
    // now returns null and redirects to sign-in. Throwing here would replace
    // that with an error page for a sign-out that actually worked.
    await expect(signOutAction()).resolves.toBeUndefined();
  });

  it("does not swallow a failed revocation", async () => {
    state.signOut.mockRejectedValue(new Error("provider unavailable"));
    // Silently "succeeding" would leave the session live while telling the user
    // they are signed out, which is the worst possible outcome here.
    await expect(signOutAction()).rejects.toThrow(/sign out failed/i);
  });

  it("attempts the revocation exactly once, with no retry loop", async () => {
    await signOutAction();
    expect(state.signOut).toHaveBeenCalledTimes(1);
  });

  it("never resolves when the session could not be constructed", async () => {
    state.clientFails = true;
    // A construction failure is a programming/deployment fault, not a
    // user-cancellable one, so it is allowed to propagate to the error boundary.
    await expect(signOutAction()).rejects.toThrow();
  });
});
