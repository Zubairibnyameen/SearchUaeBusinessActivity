import { describe, it, expect, vi } from "vitest";

import { getAccountUsage } from "@/lib/auth/account-usage";
import type { Viewer } from "@/lib/auth/viewer";

/**
 * `getAccountUsage` is the module that decides what the dashboard claims about
 * a person's activity. The important property is about HONESTY at the boundary
 * between "unknown" and "zero":
 *
 *   - Counts that could not be read  -> `available: false`, never a number
 *   - Counts that were read as zero -> `available: true, total: 0`
 *
 * A dashboard that renders the first case as `0` tells someone they have never
 * searched, which is a different and false claim. That distinction is the
 * whole point of the discriminated union, so it is pinned from both sides here.
 */
vi.mock("server-only", () => ({}));

const NOW = new Date("2026-06-15T12:00:00.000Z").getTime();

function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    authUserId: "22222222-2222-4222-8222-222222222222",
    email: "user@example.com",
    fullName: "Test User",
    avatarUrl: "https://example.test/a.png",
    provider: "google",
    role: "user",
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastLoginAt: new Date("2026-06-15T09:00:00.000Z"),
    isAdmin: false,
    isActive: true,
    ...overrides,
  };
}

/**
 * Read the unavailable branch through a real type guard. An
 * `expect(x.available).toBe(false)` does not narrow for the compiler, and
 * casting would hide exactly the mistake this union exists to prevent.
 */
function unavailableReason(usage: ReturnType<typeof getAccountUsage>): string {
  const { searches } = usage;
  if (searches.available) {
    throw new Error("expected search counts to be unavailable");
  }
  return searches.reason;
}

describe("getAccountUsage — unknown counts are never shown as zero", () => {
  it("reports search usage as unavailable when no counts are supplied", () => {
    const usage = getAccountUsage(viewer(), NOW);
    expect(usage.searches.available).toBe(false);
  });

  it("carries an explanation a user can read", () => {
    const reason = unavailableReason(getAccountUsage(viewer(), NOW));
    expect(reason).toMatch(/could not be loaded/i);
    expect(reason).toMatch(/nothing has been estimated/i);
  });

  it("carries no numeric field at all in the unavailable branch", () => {
    const usage = getAccountUsage(viewer(), NOW);
    // The unavailable branch has no `total`, so no caller can accidentally
    // render a number from it — the type does not allow one.
    expect(usage.searches).not.toHaveProperty("total");
    expect(usage.searches).not.toHaveProperty("last30Days");
  });

  it("is unavailable for an account with no history, which is unknowable here", () => {
    const usage = getAccountUsage(
      viewer({ lastLoginAt: new Date("2026-01-01T00:00:00.000Z") }),
      NOW
    );
    expect(usage.searches.available).toBe(false);
  });

  it("is unavailable for an admin too", () => {
    const usage = getAccountUsage(viewer({ role: "admin", isAdmin: true }), NOW);
    expect(usage.searches.available).toBe(false);
  });
});

describe("getAccountUsage — real counts are passed through untouched", () => {
  it("marks counts as available and reports both figures", () => {
    const usage = getAccountUsage(viewer(), NOW, { total: 128, last30Days: 17 });
    expect(usage.searches.available).toBe(true);
    expect(usage.searches).toMatchObject({ total: 128, last30Days: 17 });
  });

  it("treats a real zero as available, which is different from unknown", () => {
    // This is the distinction the whole union exists for: the counts were read
    // successfully and they happen to be zero.
    const usage = getAccountUsage(viewer(), NOW, { total: 0, last30Days: 0 });
    expect(usage.searches.available).toBe(true);
    expect(usage.searches).toMatchObject({ total: 0, last30Days: 0 });
  });

  it("does not add a reason to the available branch", () => {
    const usage = getAccountUsage(viewer(), NOW, { total: 5, last30Days: 5 });
    expect(usage.searches).not.toHaveProperty("reason");
  });

  it("does not invent counts from a partial input", () => {
    // A caller that somehow passed only `total` must not get a fabricated
    // `last30Days`; the type forbids it and the object is passed straight
    // through, so nothing is filled in behind the caller's back.
    const usage = getAccountUsage(viewer(), NOW, {
      total: 9,
      last30Days: 0,
    });
    expect(usage.searches).toEqual({
      available: true,
      total: 9,
      last30Days: 0,
    });
  });

  it("keeps the counts and the profile derivation independent", () => {
    const withCounts = getAccountUsage(viewer(), NOW, { total: 3, last30Days: 2 });
    const without = getAccountUsage(viewer(), NOW);
    expect(withCounts.profile).toEqual(without.profile);
    expect(withCounts.account).toEqual(without.account);
  });
});

describe("getAccountUsage — profile completion is genuinely derived", () => {
  it("is 100% when both optional fields are present", () => {
    const usage = getAccountUsage(viewer(), NOW);
    expect(usage.profile.percentComplete).toBe(100);
    expect(usage.profile.items.every(i => i.complete)).toBe(true);
  });

  it("is 50% when only the name is set", () => {
    const usage = getAccountUsage(viewer({ avatarUrl: null }), NOW);
    expect(usage.profile.percentComplete).toBe(50);
    const avatar = usage.profile.items.find(i => i.key === "avatarUrl");
    expect(avatar?.complete).toBe(false);
    expect(avatar?.hint).toMatch(/google account picture/i);
  });

  it("is 0% when nothing optional is set", () => {
    const usage = getAccountUsage(
      viewer({ fullName: null, avatarUrl: null }),
      NOW
    );
    expect(usage.profile.percentComplete).toBe(0);
  });

  it("treats a whitespace-only name as missing", () => {
    const usage = getAccountUsage(
      viewer({ fullName: "   ", avatarUrl: null }),
      NOW
    );
    expect(usage.profile.percentComplete).toBe(0);
  });

  it("always yields exactly the two user-controllable fields", () => {
    const usage = getAccountUsage(viewer(), NOW);
    expect(usage.profile.items.map(i => i.key)).toEqual(["fullName", "avatarUrl"]);
  });

  it("does not count email as an incomplete item — auth guarantees it", () => {
    // Email is NOT NULL in the schema, so treating it as an optional field
    // would produce a permanently-depressed score that the user cannot fix.
    const usage = getAccountUsage(viewer(), NOW);
    expect(usage.profile.items).not.toContainEqual(
      expect.objectContaining({ key: "email" })
    );
  });

  it("every incomplete item explains how to fix it", () => {
    const usage = getAccountUsage(
      viewer({ fullName: null, avatarUrl: null }),
      NOW
    );
    for (const item of usage.profile.items) {
      expect(item.hint).toBeTruthy();
    }
  });
});

describe("getAccountUsage — account facts", () => {
  it("reports member age in whole days", () => {
    const usage = getAccountUsage(
      viewer({ createdAt: new Date("2026-06-10T12:00:00.000Z") }),
      NOW
    );
    expect(usage.account.memberForDays).toBe(5);
  });

  it("floors a partial day at zero", () => {
    const usage = getAccountUsage(
      viewer({ createdAt: new Date("2026-06-15T11:00:00.000Z") }),
      NOW
    );
    expect(usage.account.memberForDays).toBe(0);
  });

  it("never reports a negative age for a clock-skewed createdAt", () => {
    // A future timestamp must not render as "-3 days on the platform".
    const usage = getAccountUsage(
      viewer({ createdAt: new Date("2027-01-01T00:00:00.000Z") }),
      NOW
    );
    expect(usage.account.memberForDays).toBe(0);
  });

  it("passes the member-since date through unchanged", () => {
    const createdAt = new Date("2026-02-03T04:05:06.000Z");
    const usage = getAccountUsage(viewer({ createdAt }), NOW);
    expect(usage.account.memberSince).toBe(createdAt);
  });

  it("summarises the last login relatively", () => {
    const usage = getAccountUsage(
      viewer({ lastLoginAt: new Date("2026-06-12T12:00:00.000Z") }),
      NOW
    );
    expect(usage.account.lastLoginRelative).toMatch(/3 days ago|3 days/);
  });

  it("reports null last login when there has never been one", () => {
    const usage = getAccountUsage(viewer({ lastLoginAt: null }), NOW);
    expect(usage.account.lastLoginAt).toBeNull();
    expect(usage.account.lastLoginRelative).toBeNull();
  });

  it("mirrors the viewer's active/admin flags without recomputing them wrong", () => {
    expect(getAccountUsage(viewer(), NOW).account.isActive).toBe(true);
    expect(getAccountUsage(viewer(), NOW).account.isAdmin).toBe(false);

    const suspendedAdmin = viewer({ status: "suspended", isActive: false, isAdmin: false });
    const usage = getAccountUsage(suspendedAdmin, NOW);
    expect(usage.account.isActive).toBe(false);
    // A suspended admin is not an admin for capability purposes.
    expect(usage.account.isAdmin).toBe(false);
  });
});

describe("getAccountUsage — no cross-account leakage", () => {
  it("takes no id argument, so it cannot be pointed at another user", () => {
    expect(getAccountUsage.length).toBe(1);
  });

  it("derives everything from the viewer it was handed", () => {
    const a = getAccountUsage(viewer({ email: "a@example.com" }), NOW);
    const b = getAccountUsage(viewer({ email: "b@example.com" }), NOW);
    expect(a.account).toEqual(b.account);
    expect(a.account).not.toHaveProperty("email");
  });

  it("never carries the provider-internal id into its result", () => {
    const usage = getAccountUsage(viewer(), NOW);
    const serialised = JSON.stringify(usage);
    expect(serialised).not.toContain("22222222-2222-4222-8222-222222222222");
    expect(serialised).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(usage.account).not.toHaveProperty("authUserId");
  });
});
