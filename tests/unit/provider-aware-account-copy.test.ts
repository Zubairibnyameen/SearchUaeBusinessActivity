import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";

/**
 * `AccountIdentityCard` reads the dashboard's own usage projection, so the
 * mocks below mirror `account-dashboard.test.ts` exactly. Fixing the clock keeps
 * the rendered member age deterministic.
 */
vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));

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
  accountFieldOwnershipNote,
  avatarDetailHint,
  avatarSourceHint,
  emailManagerHint,
  emailSourceHint,
  isGoogleProvider,
  profileReadOnlyNote,
} from "@/lib/auth/provider-copy";
import {
  ProfileDetails,
  type ProfileCardData,
} from "@/components/profile/profile-card";
import { AccountIdentityCard } from "@/components/account/account-dashboard";
import { getAccountUsage, type AccountUsage } from "@/lib/auth/account-usage";
import { renderElement } from "../helpers/render";

/**
 * Provider-aware wording on the account and profile surfaces.
 *
 * WHY THIS SUITE EXISTS
 *   The account UI told every account that its email and avatar belonged to
 *   Google: "Synced from Google. Change it in your Google account.",
 *   "Managed by Google", "Provided by Google", and two page-level paragraphs
 *   saying the same. That was written when Google was the only way in, and it
 *   became a lie the moment email + password sign-up shipped - a password user's
 *   email is not owned by Google and their avatar is not provided by it. No test
 *   caught it because every pre-existing suite mocked a Google session, so the
 *   Google branch was the only branch that had ever been exercised.
 *
 *   These tests pin all three branches - Google, credential, and unknown - and
 *   assert on the rendered output of the real components rather than only on the
 *   helper, so a component that forgets to call the helper is caught too.
 *
 * NO NEW COLUMN, NO INFERENCE
 *   The provider comes from `Viewer.provider`, already written to `app_users` by
 *   `providerIdentityOf()`. Nothing here reads the email domain or treats a
 *   present avatar as evidence of Google - both of those inferences are wrong
 *   (an `@gmail.com` address can belong to a password account, and a Google
 *   account can have no avatar), so they are asserted against explicitly.
 */

/** Every sentence the surfaces can emit that asserts Google ownership. */
const GOOGLE_OWNERSHIP_CLAIMS = [
  "synced from google",
  "change it in your google account",
  "managed by google",
  "provided by google",
  "shown from your google account",
  "belong to google",
  "re-synced on every sign-in",
];

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

/** Fixed clock: `createdAt` above is 5 days earlier, so the age is stable. */
const NOW = new Date("2026-06-15T12:00:00.000Z").getTime();

/** The dashboard's real usage projection, built from a real `app_users` shape. */
function makeUsage(provider = "google"): AccountUsage {
  return getAccountUsage(
    {
      id: "app-user-1",
      authUserId: "auth-user-1",
      email: "layla@example.com",
      fullName: "Layla Hassan",
      avatarUrl: "https://lh3.googleusercontent.test/a.png",
      provider,
      role: "user",
      status: "active",
      createdAt: new Date("2026-06-10T12:00:00.000Z"),
      lastLoginAt: new Date("2026-06-15T09:00:00.000Z"),
      isAdmin: false,
      isActive: true,
    },
    NOW,
    null
  );
}

/** Asserts no rendered text claims Google owns anything. */
function expectNoGoogleOwnership(text: string): void {
  const lowered = text.toLowerCase();
  for (const claim of GOOGLE_OWNERSHIP_CLAIMS) {
    expect(
      lowered,
      `rendered copy still claims "${claim}": ${text}`
    ).not.toContain(claim);
  }
}

describe("provider detection", () => {
  it("recognises only google, case- and whitespace-insensitively", () => {
    expect(isGoogleProvider("google")).toBe(true);
    expect(isGoogleProvider("Google")).toBe(true);
    expect(isGoogleProvider("  GOOGLE  ")).toBe(true);
  });

  it("treats every other value as not-Google", () => {
    for (const value of [
      "email",
      "EMAIL",
      "azure",
      "facebook",
      "google.com",
      "not-google",
      "gmail",
      "",
      "   ",
      null,
      undefined,
    ]) {
      expect(isGoogleProvider(value), `${String(value)} must not be Google`).toBe(
        false
      );
    }
  });

  it("never infers Google from a Google-looking email address", () => {
    // A password account can use an @gmail.com address. Nothing in this module
    // receives an email, so the domain cannot influence the wording.
    expect(emailSourceHint("email")).toBe("Used to sign in to your account.");
  });

  it("never infers Google from the presence of an avatar", () => {
    // A credential account may have an uploaded avatar; a Google account may
    // have none. The avatar only decides WHICH neutral/Google phrasing, and
    // never WHICH provider.
    expect(avatarDetailHint("email", true)).toBe("Shown from your account");
    expect(avatarDetailHint("email", false)).toBe("None — showing initials");
    expect(avatarDetailHint("google", false)).toBe("None — showing initials");
  });
});

describe("Google accounts keep their Google-specific wording", () => {
  it("keeps the email hint pointing at the Google account", () => {
    expect(emailSourceHint("google")).toBe(
      "Synced from Google. Change it in your Google account."
    );
  });

  it("keeps the dashboard email hint", () => {
    expect(emailManagerHint("google")).toBe("Managed by Google");
  });

  it("keeps the avatar hints", () => {
    expect(avatarSourceHint("google")).toBe("Provided by Google.");
    expect(avatarDetailHint("google", true)).toBe("Shown from your Google account");
  });

  it("keeps both page-level ownership paragraphs", () => {
    expect(accountFieldOwnershipNote("google")).toBe(
      "Email and profile picture belong to Google"
    );
    expect(profileReadOnlyNote("google")).toContain("belong to Google");
    expect(profileReadOnlyNote("google")).toContain(
      "edit them in your Google account"
    );
  });

  it("renders the unchanged Google copy in the profile card", async () => {
    const { text } = await renderElement(
      createElement(ProfileDetails, { profile: makeProfile() })
    );

    expect(text).toContain("Synced from Google. Change it in your Google account.");
    expect(text).toContain("Provided by Google.");
    expect(text).toContain("Shown from your Google account");
    // The provider badge keeps reporting the real provider.
    expect(text).toContain("Sign-in provider");
    expect(text).toContain("Google");
  });

  it("renders the unchanged Google copy on the dashboard", async () => {
    const { text } = await renderElement(
      createElement(AccountIdentityCard, {
        profile: makeProfile(),
        usage: makeUsage("google"),      })
    );

    expect(text).toContain("Managed by Google");
  });
});

describe("email + password accounts are told the truth", () => {
  it("uses neutral wording for every hint", () => {
    expect(emailSourceHint("email")).toBe("Used to sign in to your account.");
    expect(emailManagerHint("email")).toBe("Managed by your account");
    expect(avatarSourceHint("email")).toBe("Provided by your account.");
    expect(avatarDetailHint("email", true)).toBe("Shown from your account");
  });

  it("uses neutral page-level paragraphs", () => {
    expect(accountFieldOwnershipNote("email")).toBe(
      "Email and profile picture are managed by your account"
    );
    expect(profileReadOnlyNote("email")).toBe(
      "Your email address, profile picture and sign-in provider are managed by your account and cannot be changed here."
    );
  });

  it("never tells a password user to edit their details in Google", () => {
    expect(profileReadOnlyNote("email")).not.toMatch(/google/i);
  });

  it("renders no Google ownership claim in the profile card", async () => {
    const { text } = await renderElement(
      createElement(ProfileDetails, { profile: makeProfile({ provider: "email" }) })
    );

    expectNoGoogleOwnership(text);
    expect(text).toContain("Used to sign in to your account.");
    expect(text).toContain("Provided by your account.");
    expect(text).toContain("Shown from your account");
  });

  it("renders no Google ownership claim on the dashboard", async () => {
    const { text } = await renderElement(
      createElement(AccountIdentityCard, {
        profile: makeProfile({ provider: "email" }),
        usage: makeUsage("email"),
      })
    );

    expectNoGoogleOwnership(text);
    expect(text).toContain("Managed by your account");
  });

  it("still reports the real provider in the badge", async () => {
    // Neutral phrasing about ownership must not become provider-blindness: the
    // sign-in provider row is a factual field and still reads `email`.
    const { text } = await renderElement(
      createElement(ProfileDetails, { profile: makeProfile({ provider: "email" }) })
    );

    expect(text).toContain("Sign-in provider");
    expect(text).toContain("email");
  });
});

describe("an undeterminable provider falls back to neutral wording", () => {
  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["an unrecognised provider", "some-future-idp"],
    ["a google-lookalike", "google.com"],
  ])("treats %s as not-Google", async (_label, provider) => {
    const { text } = await renderElement(
      createElement(ProfileDetails, {
        profile: makeProfile({ provider }),
      })
    );

    expectNoGoogleOwnership(text);
  });

  it("defaults to neutral when the provider is missing entirely", async () => {
    // An absent provider must never resolve to Google. This is the case that
    // matters most: `providerIdentityOf()` falls back to `"email"` when the
    // session metadata is silent, and a row written before the fallback existed
    // may have no provider at all.
    const { text } = await renderElement(
      createElement(ProfileDetails, {
        profile: makeProfile({
          provider: undefined as unknown as string,
        }),
      })
    );

    expectNoGoogleOwnership(text);
    expect(text).toContain("Used to sign in to your account.");
  });

  it("keeps the avatar fallback identical across providers", async () => {
    const noAvatar = await renderElement(
      createElement(ProfileDetails, {
        profile: makeProfile({ provider: "email", avatarUrl: null }),
      })
    );

    expect(noAvatar.text).toContain("None — showing initials");
    // And the source hint still follows the provider, not the avatar's absence.
    expect(noAvatar.text).toContain("Provided by your account.");
  });
});

describe("unrelated account behaviour is untouched", () => {
  it("still renders every protected field label for a password user", async () => {
    const { text } = await renderElement(
      createElement(ProfileDetails, { profile: makeProfile({ provider: "email" }) })
    );

    for (const label of [
      "Full name",
      "Email",
      "Account role",
      "Account status",
      "Sign-in provider",
      "Account created",
      "Last login",
      "Profile picture",
    ]) {
      expect(text).toContain(label);
    }
  });

  it("still labels every dashboard fact for a password user", async () => {
    const { text } = await renderElement(
      createElement(AccountIdentityCard, {
        profile: makeProfile({ provider: "email" }),
        usage: makeUsage("email"),
      })
    );

    for (const label of ["Full name", "Email", "Member since", "Last login"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("layla@example.com");
  });

  it("still applies the same date, name and greeting rendering", async () => {
    const google = await renderElement(
      createElement(AccountIdentityCard, {
        profile: makeProfile(),
        usage: makeUsage("google"),
      })
    );
    const email = await renderElement(
      createElement(AccountIdentityCard, {
        profile: makeProfile({ provider: "email" }),
        usage: makeUsage("email"),
      })
    );

    // The only difference between the two renderings must be the ownership
    // wording. If a future change also perturbs the greeting, the member age or
    // the formatted timestamps, this fails.
    expect(email.text).toContain("Hi, Layla");
    expect(email.text).toContain("Layla Hassan");
    expect(email.text).toContain("5 days on the platform");
    expect(email.text.replace(/\s+/g, " ")).toBe(
      google.text
        .replace(/\s+/g, " ")
        .replace("Managed by Google", "Managed by your account")
    );
  });
});
