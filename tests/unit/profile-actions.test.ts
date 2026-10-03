import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  authState,
  makeViewer,
  resetAuth,
  signInAsAdmin,
  signInAsSuspended,
  signInAsUser,
} from "../helpers/auth-mock";

/**
 * The profile actions are the reachable-from-a-raw-POST surface for profile
 * changes, so these tests drive them exactly the way a browser would: a
 * FormData, no session helper, and — for the escalation cases — extra keys a
 * real user could only add by opening devtools.
 *
 * Authorization is asserted by observing the *gate*: the DAL must never be
 * reached by a caller who should be refused.
 */
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  ownProfile: vi.fn(),
  userProfileName: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/viewer", async () => {
  const { authViewerMock } = await import("../helpers/auth-mock");
  return authViewerMock();
});

vi.mock("@/lib/auth/profile", () => ({
  updateOwnProfile: state.ownProfile,
  updateUserProfileName: state.userProfileName,
}));

vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));

import {
  updateAdminProfileAction,
  updateOwnProfileAction,
  updateUserProfileNameAction,
} from "@/lib/auth/profile-actions";
import type { ProfileActionState } from "@/components/profile/profile-name-form";

const PREV: ProfileActionState = { ok: false, message: "", fullName: null };
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuth();
  state.ownProfile.mockResolvedValue({
    id: USER_ID,
    email: "user@example.com",
    fullName: "New Name",
    avatarUrl: null,
    provider: "google",
    role: "user",
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
    isAdmin: false,
    isActive: true,
  });
  state.userProfileName.mockResolvedValue({
    id: OTHER_ID,
    email: "other@example.com",
    fullName: "New Name",
    avatarUrl: null,
    provider: "google",
    role: "user",
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Authenticated user can view / update their own profile
// ─────────────────────────────────────────────────────────────────────────────

describe("updateOwnProfileAction — authorized", () => {
  it("updates the caller's own name for an authenticated user", async () => {
    signInAsUser();
    const result = await updateOwnProfileAction(PREV, form({ fullName: "New Name" }));

    expect(result.ok).toBe(true);
    expect(result.fullName).toBe("New Name");
    expect(state.ownProfile).toHaveBeenCalledWith(USER_ID, { fullName: "New Name" });
  });

  it("targets the id from the verified session, never a form field", async () => {
    signInAsUser();
    // A payload that also names a different account must be refused outright.
    const result = await updateOwnProfileAction(
      PREV,
      form({ fullName: "New Name", userId: OTHER_ID })
    );

    expect(result.ok).toBe(false);
    expect(state.ownProfile).not.toHaveBeenCalled();
  });

  it("clears the name when submitted empty", async () => {
    signInAsUser();
    state.ownProfile.mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
      fullName: null,
      avatarUrl: null,
      provider: "google",
      role: "user",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: new Date(),
      isAdmin: false,
      isActive: true,
    });

    const result = await updateOwnProfileAction(PREV, form({ fullName: "" }));
    expect(result.ok).toBe(true);
    expect(result.fullName).toBeNull();
    expect(result.message).toMatch(/name removed/i);
  });

  it("revalidates the surfaces that render the name", async () => {
    signInAsUser();
    await updateOwnProfileAction(PREV, form({ fullName: "New Name" }));

    const paths = state.revalidatePath.mock.calls.map(c => c[0]);
    expect(paths).toContain("/account");
    expect(paths).toContain("/account/profile");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Unauthenticated user cannot reach the profile write path
// ─────────────────────────────────────────────────────────────────────────────

describe("updateOwnProfileAction — unauthorized", () => {
  it("refuses an anonymous caller and never touches the database", async () => {
    resetAuth();
    const result = await updateOwnProfileAction(PREV, form({ fullName: "Mallory" }));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/sign in/i);
    expect(state.ownProfile).not.toHaveBeenCalled();
  });

  it("refuses a suspended user", async () => {
    signInAsSuspended();
    const result = await updateOwnProfileAction(PREV, form({ fullName: "Mallory" }));

    expect(result.ok).toBe(false);
    expect(state.ownProfile).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. A user cannot modify role / status / email / authUserId
// ─────────────────────────────────────────────────────────────────────────────

describe("updateOwnProfileAction — privilege escalation", () => {
  const ATTACKS: Array<Record<string, string>> = [
    { role: "admin" },
    { status: "active" },
    { email: "attacker@evil.test" },
    { authUserId: "22222222-2222-4222-8222-222222222222" },
    { id: OTHER_ID },
    { createdAt: "1999-01-01T00:00:00.000Z" },
    { lastLoginAt: "1999-01-01T00:00:00.000Z" },
    { isAdmin: "true" },
  ];

  it.each(ATTACKS)(
    "refuses a self-service payload carrying %j",
    async attack => {
      signInAsUser();
      const result = await updateOwnProfileAction(
        PREV,
        form({ fullName: "Mallory", ...attack })
      );

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/only your name/i);
      // The decisive assertion: the write path was never reached.
      expect(state.ownProfile).not.toHaveBeenCalled();
    }
  );

  it("a normal user cannot promote themselves even with a valid name", async () => {
    signInAsUser();
    const result = await updateOwnProfileAction(
      PREV,
      form({ fullName: "Mallory", role: "admin", status: "active" })
    );

    expect(result.ok).toBe(false);
    expect(state.ownProfile).not.toHaveBeenCalled();
  });

  it("rejects a name beyond the column length without echoing it", async () => {
    signInAsUser();
    const tooLong = "z".repeat(300);
    const result = await updateOwnProfileAction(PREV, form({ fullName: tooLong }));

    expect(result.ok).toBe(false);
    expect(result.message).not.toContain(tooLong);
    expect(state.ownProfile).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Admin profile
// ─────────────────────────────────────────────────────────────────────────────

describe("updateAdminProfileAction", () => {
  it("lets an admin edit their own name", async () => {
    signInAsAdmin();
    const result = await updateAdminProfileAction(PREV, form({ fullName: "Admin Name" }));

    expect(result.ok).toBe(true);
    expect(state.userProfileName).toHaveBeenCalledWith({
      targetUserId: USER_ID,
      actingAdminId: USER_ID,
      input: { fullName: "Admin Name" },
    });
  });

  it("refuses a non-admin", async () => {
    signInAsUser();
    const result = await updateAdminProfileAction(PREV, form({ fullName: "Mallory" }));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/administrator access is required/i);
    expect(state.userProfileName).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller", async () => {
    resetAuth();
    const result = await updateAdminProfileAction(PREV, form({ fullName: "Mallory" }));

    expect(result.ok).toBe(false);
    expect(state.userProfileName).not.toHaveBeenCalled();
  });

  it("offers no way to self-promote or change own status", async () => {
    signInAsAdmin();
    const result = await updateAdminProfileAction(
      PREV,
      form({ fullName: "Admin", role: "user", status: "suspended" })
    );

    expect(result.ok).toBe(false);
    expect(state.userProfileName).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Admin editing another user
// ─────────────────────────────────────────────────────────────────────────────

describe("updateUserProfileNameAction", () => {
  it("updates another user's name for an admin", async () => {
    signInAsAdmin();
    const result = await updateUserProfileNameAction(
      PREV,
      form({ fullName: "Corrected", userId: OTHER_ID })
    );

    expect(result.ok).toBe(true);
    expect(state.userProfileName).toHaveBeenCalledWith({
      targetUserId: OTHER_ID,
      actingAdminId: USER_ID,
      input: { fullName: "Corrected" },
    });
  });

  it("refuses a non-admin entirely", async () => {
    signInAsUser();
    const result = await updateUserProfileNameAction(
      PREV,
      form({ fullName: "Mallory", userId: OTHER_ID })
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/administrator access is required/i);
    expect(state.userProfileName).not.toHaveBeenCalled();
  });

  it("refuses a suspended admin", async () => {
    signInAsSuspended({ role: "admin", status: "suspended" });
    const result = await updateUserProfileNameAction(
      PREV,
      form({ fullName: "X", userId: OTHER_ID })
    );

    expect(result.ok).toBe(false);
    expect(state.userProfileName).not.toHaveBeenCalled();
  });

  it("rejects a malformed or non-UUID target id", async () => {
    signInAsAdmin();
    for (const bad of ["", "not-a-uuid", "../../etc/passwd", "1 OR 1=1"]) {
      const result = await updateUserProfileNameAction(
        PREV,
        form({ fullName: "X", userId: bad })
      );
      expect(result.ok).toBe(false);
    }
    expect(state.userProfileName).not.toHaveBeenCalled();
  });

  it("rejects a missing target id", async () => {
    signInAsAdmin();
    const result = await updateUserProfileNameAction(PREV, form({ fullName: "X" }));
    expect(result.ok).toBe(false);
    expect(state.userProfileName).not.toHaveBeenCalled();
  });

  it("refuses an admin payload that tries to change role or status", async () => {
    signInAsAdmin();
    const result = await updateUserProfileNameAction(
      PREV,
      form({ fullName: "X", userId: OTHER_ID, role: "admin", status: "active" })
    );

    expect(result.ok).toBe(false);
    expect(state.userProfileName).not.toHaveBeenCalled();
  });

  it("allows only fullName and userId as form keys", async () => {
    signInAsAdmin();
    // Both of these are legitimate; anything beyond them is refused. This pins
    // the allowlist so a future field cannot be added to the form by accident.
    const ok = await updateUserProfileNameAction(
      PREV,
      form({ fullName: "X", userId: OTHER_ID })
    );
    expect(ok.ok).toBe(true);

    const bad = await updateUserProfileNameAction(
      PREV,
      form({ fullName: "X", userId: OTHER_ID, email: "a@b.test" })
    );
    expect(bad.ok).toBe(false);
  });

  it("surfaces a data-layer guard without leaking internals", async () => {
    signInAsAdmin();
    const { ForbiddenError } = await import("@/lib/auth/errors");
    state.userProfileName.mockRejectedValue(
      new ForbiddenError("You cannot change your own account status")
    );

    const result = await updateUserProfileNameAction(
      PREV,
      form({ fullName: "X", userId: OTHER_ID })
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/cannot change your own account status/i);
  });

  it("returns a generic message for an unexpected error", async () => {
    signInAsAdmin();
    state.userProfileName.mockRejectedValue(new Error("connect ECONNREFUSED db:5432"));

    const result = await updateUserProfileNameAction(
      PREV,
      form({ fullName: "X", userId: OTHER_ID })
    );
    expect(result.ok).toBe(false);
    expect(result.message).not.toMatch(/ECONNREFUSED|5432/);
    expect(result.message).toMatch(/could not update/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The auth mock used by these tests must mirror production, or they lie
// ─────────────────────────────────────────────────────────────────────────────

describe("auth mock fidelity", () => {
  it("isAdmin is false for a suspended admin", () => {
    // If this ever became true, every "suspended users stay blocked" assertion
    // in the suite would be silently meaningless.
    const viewer = makeViewer({ role: "admin", status: "suspended" });
    expect(viewer.isAdmin).toBe(false);
    expect(viewer.isActive).toBe(false);
  });

  it("resets to no session between tests", () => {
    expect(authState.viewer).toBeNull();
  });
});
