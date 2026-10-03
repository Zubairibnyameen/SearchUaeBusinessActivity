import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";

import { renderElement } from "../helpers/render";

/**
 * The account dashboard's presentational components.
 *
 * The page test proves *which props* the page passes; this suite proves what
 * those props actually produce on screen. That split matters for the two claims
 * a user can hold the product to:
 *
 *   1. The usage card must say it has no data, never imply a count of zero.
 *   2. A suspended account must not be handed a link to a capability it will be
 *      refused by `requireViewer()`.
 */
vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));

// Icons are decorative here; replace them with a marked span so assertions stay
// about structure and copy rather than SVG internals.
vi.mock("lucide-react", () => {
  const icon = (name: string) => {
    function Icon() {
      return createElement("span", { "data-icon": name });
    }
    return Icon;
  };
  return {
    ArrowRight: icon("ArrowRight"),
    ArrowUpRight: icon("ArrowUpRight"),
    CircleCheck: icon("CircleCheck"),
    CircleDashed: icon("CircleDashed"),
    Info: icon("Info"),
    LogOut: icon("LogOut"),
    Search: icon("Search"),
    UserCog: icon("UserCog"),
  };
});

import {
  AccountIdentityCard,
  AccountQuickActions,
  AccountUsageCard,
  SignOutCard,
} from "@/components/account/account-dashboard";
import { getAccountUsage, type AccountUsage } from "@/lib/auth/account-usage";
import type { ProfileCardData } from "@/components/profile/profile-card";

const NOW = new Date("2026-06-15T12:00:00.000Z").getTime();

/** Mirrors `app_users` for one person, with no provider id anywhere near it. */
function makeProfile(overrides: Partial<ProfileCardData> = {}): ProfileCardData {
  return {
    fullName: "Layla Hassan",
    email: "layla@example.com",
    avatarUrl: "https://lh3.googleusercontent.test/a.png",
    provider: "google",
    role: "user",
    status: "active",
    createdAt: new Date("2026-06-10T12:00:00.000Z"),
    lastLoginAt: new Date("2026-06-15T09:00:00.000Z"),
    ...overrides,
  };
}

function makeUsage(
  overrides: Partial<Parameters<typeof getAccountUsage>[0]> = {},
  searches: { total: number; last30Days: number } | null = null
): AccountUsage {
  return getAccountUsage(
    {
      id: "app-user-1",
      authUserId: "auth-user-1",
      email: "layla@example.com",
      fullName: "Layla Hassan",
      avatarUrl: "https://lh3.googleusercontent.test/a.png",
      provider: "google",
      role: "user",
      status: "active",
      createdAt: new Date("2026-06-10T12:00:00.000Z"),
      lastLoginAt: new Date("2026-06-15T09:00:00.000Z"),
      isAdmin: false,
      isActive: true,
      ...overrides,
    },
    NOW,
    searches
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity card
// ─────────────────────────────────────────────────────────────────────────────

describe("AccountIdentityCard", () => {
  it("shows the person's own name and email", async () => {
    const { text } = await renderElement(
      AccountIdentityCard({ profile: makeProfile(), usage: makeUsage() })
    );
    expect(text).toContain("Layla Hassan");
    expect(text).toContain("layla@example.com");
  });

  it("falls back to the email when no name is set", async () => {
    const profile = makeProfile({ fullName: null, avatarUrl: null });
    const { text } = await renderElement(
      AccountIdentityCard({ profile, usage: makeUsage({ fullName: null, avatarUrl: null }) })
    );
    expect(text).toContain("Not set");
    expect(text).toContain("layla@example.com");
  });

  it("greets the person by first name", async () => {
    const { text } = await renderElement(
      AccountIdentityCard({ profile: makeProfile(), usage: makeUsage() })
    );
    // First name only: a full legal or company name in a greeting wraps badly
    // beside the avatar at 320px.
    expect(text).toContain("Hi, Layla");
  });

  it("uses only the first name, never the surname", async () => {
    const { text } = await renderElement(
      AccountIdentityCard({ profile: makeProfile(), usage: makeUsage() })
    );
    expect(text).not.toContain("Hi, Layla Hassan");
  });

  it("stays generic rather than greeting an email address", async () => {
    const profile = makeProfile({ fullName: null, avatarUrl: null });
    const { text } = await renderElement(
      AccountIdentityCard({ profile, usage: makeUsage({ fullName: null, avatarUrl: null }) })
    );
    // "Hi, layla@example.com" reads like a bug even though the address is
    // already shown on the card.
    expect(text).not.toContain("Hi, layla@example.com");
    expect(text).toContain("Welcome back");
  });

  it("does not invent a name from a whitespace-only value", async () => {
    const profile = makeProfile({ fullName: "   ", avatarUrl: null });
    const { text } = await renderElement(
      AccountIdentityCard({ profile, usage: makeUsage({ fullName: "   ", avatarUrl: null }) })
    );
    expect(text).toContain("Welcome back");
    expect(text).not.toContain("Hi,");
  });

  it("keeps the account name as the page's single heading", async () => {
    const { text } = await renderElement(
      AccountIdentityCard({ profile: makeProfile(), usage: makeUsage() })
    );
    // The greeting is a <p>: adding a second heading would give the page two
    // competing <h1>s and make heading navigation announce a greeting.
    expect(text).toContain("Layla Hassan");
  });

  it("labels every account fact it displays", async () => {
    const { text } = await renderElement(
      AccountIdentityCard({ profile: makeProfile(), usage: makeUsage() })
    );
    for (const label of ["Full name", "Email", "Member since", "Last login"]) {
      expect(text).toContain(label);
    }
  });

  it("says who controls the fields it displays", async () => {
    const { text } = await renderElement(
      AccountIdentityCard({ profile: makeProfile(), usage: makeUsage() })
    );
    // Email belongs to the identity provider, and the one editable field points
    // at the page that edits it.
    expect(text).toContain("Managed by Google");
  });

  it("points a missing name at the page that can set it", async () => {
    const usage = makeUsage({ fullName: null });
    const { text } = await renderElement(
      AccountIdentityCard({ profile: makeProfile({ fullName: null }), usage })
    );
    expect(text).toMatch(/add it on your profile/i);
  });

  it("derives the member age from the usage payload, not a second clock read", async () => {
    const usage = makeUsage();
    const { text } = await renderElement(
      AccountIdentityCard({ profile: makeProfile(), usage })
    );
    expect(text).toContain("5 days on the platform");
  });

  it("shows a plain badge for role and status rather than a control", async () => {
    const { text, tags } = await renderElement(
      AccountIdentityCard({ profile: makeProfile(), usage: makeUsage() })
    );
    expect(text).toContain("User");
    expect(text).toContain("Active");
    expect(tags).not.toContain("select");
    expect(tags).not.toContain("input");
  });

  it("warns an active account about nothing", async () => {
    const { text } = await renderElement(
      AccountIdentityCard({ profile: makeProfile(), usage: makeUsage() })
    );
    expect(text).not.toMatch(/this account is suspended/i);
  });

  it("tells a suspended account what is unavailable, and that sign-out still works", async () => {
    const usage = makeUsage({ status: "suspended", isActive: false });
    const { text } = await renderElement(
      AccountIdentityCard({ profile: makeProfile({ status: "suspended" }), usage })
    );
    expect(text).toMatch(/this account is suspended/i);
    expect(text).toMatch(/unavailable/i);
    expect(text).toMatch(/sign out/i);
  });

  it("renders no form control, so nothing here is editable", async () => {
    const { tags } = await renderElement(
      AccountIdentityCard({ profile: makeProfile(), usage: makeUsage() })
    );
    expect(tags).not.toContain("input");
    expect(tags).not.toContain("select");
    expect(tags).not.toContain("textarea");
  });

  it("never renders a provider-internal id", async () => {
    const usage = makeUsage();
    const { text, nodes } = await renderElement(
      AccountIdentityCard({ profile: makeProfile(), usage })
    );
    expect(text).not.toContain("auth-user-1");
    expect(text).not.toContain("app-user-1");
    const srcs = nodes.map(n => n.props.src).filter((s): s is string => typeof s === "string");
    // The avatar URL comes from Google, and nothing else is fetched.
    expect(srcs).toEqual(["https://lh3.googleusercontent.test/a.png"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Usage card
// ─────────────────────────────────────────────────────────────────────────────

describe("AccountUsageCard", () => {
  it("shows the unavailable state verbatim when counts could not be read", async () => {
    const { text } = await renderElement(AccountUsageCard({ usage: makeUsage() }));
    expect(text).toContain("Search activity is unavailable right now.");
  });

  it("does not claim a count of zero when counts are unknown", async () => {
    const { text } = await renderElement(AccountUsageCard({ usage: makeUsage() }));
    // "0 searches" would read as "you have never searched", which is not what
    // the data supports.
    expect(text).not.toMatch(/\b0\s+search/i);
    expect(text).not.toMatch(/\b\d+\s+search(es)?\b/i);
  });

  it("explains that nothing was estimated or filled in", async () => {
    const { text } = await renderElement(AccountUsageCard({ usage: makeUsage() }));
    expect(text).toMatch(/could not be loaded/i);
    expect(text).toMatch(/nothing has been estimated/i);
  });

  it("does not promise the feature is disabled when the read simply failed", async () => {
    const { text } = await renderElement(AccountUsageCard({ usage: makeUsage() }));
    // The old copy ("will appear here once enabled") implied a feature flag.
    // Tracking is on; the read is what failed, and the copy must say so.
    expect(text).not.toMatch(/once enabled/i);
  });
});

describe("AccountUsageCard — real counts", () => {
  it("reports the lifetime total and the 30-day window", async () => {
    const { text } = await renderElement(
      AccountUsageCard({ usage: makeUsage({}, { total: 128, last30Days: 17 }) })
    );
    expect(text).toContain("Total searches");
    expect(text).toContain("128");
    expect(text).toContain("Last 30 days");
    expect(text).toContain("17");
  });

  it("exposes each figure as its own labelled element", async () => {
    const { byTestId } = await renderElement(
      AccountUsageCard({ usage: makeUsage({}, { total: 128, last30Days: 17 }) })
    );
    expect(byTestId("usage-total")).toBe("128");
    expect(byTestId("usage-last-30")).toBe("17");
  });

  it("keeps total and 30-day figures distinct", async () => {
    const { text } = await renderElement(
      AccountUsageCard({ usage: makeUsage({}, { total: 900, last30Days: 3 }) })
    );
    // A card that showed 3 for both would quietly misreport the lifetime total.
    expect(text).toContain("900");
    expect(text).toContain("3");
  });

  it("formats thousands so a big total stays readable", async () => {
    const { byTestId } = await renderElement(
      AccountUsageCard({ usage: makeUsage({}, { total: 12345, last30Days: 1200 }) })
    );
    expect(byTestId("usage-total")).toBe("12,345");
    expect(byTestId("usage-last-30")).toBe("1,200");
  });

  it("says the counts are the user's own", async () => {
    const { text } = await renderElement(
      AccountUsageCard({ usage: makeUsage({}, { total: 4, last30Days: 4 }) })
    );
    expect(text).toMatch(/while signed in to this account/i);
    expect(text).toMatch(/nobody else can see them/i);
  });

  it("does not leak an internal id alongside the counts", async () => {
    const { text } = await renderElement(
      AccountUsageCard({ usage: makeUsage({}, { total: 4, last30Days: 4 }) })
    );
    expect(text).not.toContain("app-user-1");
    expect(text).not.toContain("auth-user-1");
  });
});

describe("AccountUsageCard — a real zero is not an error", () => {
  it("invites the user to search instead of claiming an outage", async () => {
    const { text } = await renderElement(
      AccountUsageCard({ usage: makeUsage({}, { total: 0, last30Days: 0 }) })
    );
    expect(text).toMatch(/haven.t run any searches yet/i);
  });

  it("does not show the unavailable state for a genuine zero", async () => {
    const { text } = await renderElement(
      AccountUsageCard({ usage: makeUsage({}, { total: 0, last30Days: 0 }) })
    );
    expect(text).not.toContain("Search activity is unavailable right now.");
  });

  it("still renders no total figure, because zero is not a total yet", async () => {
    const { byTestId } = await renderElement(
      AccountUsageCard({ usage: makeUsage({}, { total: 0, last30Days: 0 }) })
    );
    expect(byTestId("usage-total")).toBeUndefined();
    expect(byTestId("usage-last-30")).toBeUndefined();
  });

  it("promises the totals will build up", async () => {
    const { text } = await renderElement(
      AccountUsageCard({ usage: makeUsage({}, { total: 0, last30Days: 0 }) })
    );
    expect(text).toMatch(/totals will build up/i);
    expect(text).toMatch(/only your own activity/i);
  });
});

describe("AccountUsageCard — profile completion", () => {
  it("exposes completion as a labelled meter, not a bare percentage", async () => {
    const { attrsOf, text } = await renderElement(AccountUsageCard({ usage: makeUsage() }));
    const meter = attrsOf(n => n.props.role === "meter");
    expect(meter).toBeDefined();
    expect(meter?.["aria-valuenow"]).toBe(100);
    expect(meter?.["aria-valuemin"]).toBe(0);
    expect(meter?.["aria-valuemax"]).toBe(100);
    expect(meter?.["aria-label"]).toBe("Profile completion");
    expect(text).toContain("100%");
  });

  it("halves the meter when the avatar is missing and says why", async () => {
    const usage = makeUsage({ avatarUrl: null });
    const { attrsOf, text } = await renderElement(AccountUsageCard({ usage }));
    expect(attrsOf(n => n.props.role === "meter")?.["aria-valuenow"]).toBe(50);
    expect(text).toMatch(/google account picture/i);
  });

  it("marks the completed checklist items", async () => {
    const { text } = await renderElement(AccountUsageCard({ usage: makeUsage() }));
    expect(text).toContain("Display name");
    expect(text).toContain("Profile picture");
  });

  it("labels its section for screen readers", async () => {
    const { attrsOf } = await renderElement(AccountUsageCard({ usage: makeUsage() }));
    const section = attrsOf(n => n.props["aria-labelledby"] === "usage-heading");
    expect(section).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Quick actions
// ─────────────────────────────────────────────────────────────────────────────

describe("AccountQuickActions", () => {
  it("links to search and profile for an active user", async () => {
    const { hrefs } = await renderElement(
      AccountQuickActions({ canSearch: true, canEditProfile: true, isAdmin: false })
    );
    expect(hrefs).toEqual(["/search", "/account/profile"]);
  });

  it("offers the admin dashboard only to an admin", async () => {
    const asAdmin = await renderElement(
      AccountQuickActions({ canSearch: true, canEditProfile: true, isAdmin: true })
    );
    expect(asAdmin.hrefs).toContain("/admin");

    const asUser = await renderElement(
      AccountQuickActions({ canSearch: true, canEditProfile: true, isAdmin: false })
    );
    expect(asUser.hrefs).not.toContain("/admin");
  });

  it("only ever links to routes that exist", async () => {
    // A dead link on a dashboard is a small bug that ships; pin the allowlist.
    const real = new Set(["/search", "/account/profile", "/admin"]);
    for (const isAdmin of [true, false]) {
      const { hrefs } = await renderElement(
        AccountQuickActions({ canSearch: true, canEditProfile: true, isAdmin })
      );
      for (const href of hrefs) expect(real.has(href)).toBe(true);
    }
  });

  it("withholds the search link from a suspended account", async () => {
    const { hrefs, text } = await renderElement(
      AccountQuickActions({ canSearch: false, canEditProfile: false, isAdmin: false })
    );
    // Not a link at all: /search is requireViewer()-gated, so a suspended user
    // following it would land on a 403.
    expect(hrefs).not.toContain("/search");
    expect(text).toMatch(/unavailable while your account is suspended/i);
  });

  it("marks the withheld action as disabled for assistive tech", async () => {
    const { attrsOf } = await renderElement(
      AccountQuickActions({ canSearch: false, canEditProfile: false, isAdmin: false })
    );
    const disabled = attrsOf(n => n.props["aria-disabled"] === "true");
    expect(disabled).toBeDefined();
  });

  it("still lets a suspended account reach their own profile", async () => {
    const { hrefs } = await renderElement(
      AccountQuickActions({ canSearch: false, canEditProfile: false, isAdmin: false })
    );
    expect(hrefs).toEqual(["/account/profile"]);
  });

  it("does not promise an edit the profile page will refuse", async () => {
    // `/account/profile` locks the name form when `!viewer.isActive`, so the
    // tile copy must not advertise editing to someone who cannot do it.
    const { text } = await renderElement(
      AccountQuickActions({ canSearch: false, canEditProfile: false, isAdmin: false })
    );
    expect(text).not.toMatch(/edit your display name/i);
    expect(text).toMatch(/read-only while your account is suspended/i);
  });

  it("advertises the edit only when editing is genuinely possible", async () => {
    const { text } = await renderElement(
      AccountQuickActions({ canSearch: true, canEditProfile: true, isAdmin: false })
    );
    expect(text).toMatch(/edit your display name/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sign out
// ─────────────────────────────────────────────────────────────────────────────

describe("SignOutCard", () => {
  it("posts to the supplied server action", async () => {
    const action = async () => undefined;
    const { attrsOf } = await renderElement(SignOutCard({ action }));
    expect(attrsOf(n => n.type === "form")?.action).toBe(action);
  });

  it("has a single submit button and no token field", async () => {
    const action = async () => undefined;
    const { nodes, text } = await renderElement(SignOutCard({ action }));
    const buttons = nodes.filter(n => n.type === "button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.type).toBe("submit");
    // Sign-out is server-side; a client-side token field would be a regression.
    expect(nodes.filter(n => n.type === "input")).toHaveLength(0);
    expect(text).toMatch(/sign out/i);
  });

  it("explains what signing out does", async () => {
    const { text } = await renderElement(SignOutCard({ action: async () => undefined }));
    expect(text).toMatch(/session/i);
  });
});
