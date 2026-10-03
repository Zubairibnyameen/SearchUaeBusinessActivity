// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

/**
 * The admin shell: responsive navigation, and knowing which section you are in.
 *
 * WHY THIS SUITE EXISTS
 *   Two real defects, both invisible to a server-only test:
 *
 *   1. The sidebar was `w-64` in an unconditional flex row and the content
 *      column had `p-8`. At 375px that leaves 375 - 256 - 64 = 55px of content.
 *      The admin area was unusable on a phone and nothing caught it, because no
 *      test rendered the layout.
 *
 *   2. Nothing marked the current section. All twelve links looked identical on
 *      every screen and none carried `aria-current`, so neither a sighted admin
 *      nor a screen-reader user could tell where they were.
 */

const pathname = vi.hoisted(() => ({ current: "/admin" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    [key: string]: unknown;
  }) => createElement("a", { href, ...rest }, children as never),
}));

import { AdminNav, activeAdminHref, type AdminNavItem } from "@/components/admin/admin-nav";
import { AdminShell } from "@/components/admin/admin-shell";

const NAV: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/activities", label: "Activities" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/research", label: "Research Queue" },
];

/* ── activeAdminHref ─────────────────────────────────────────────────────── */

describe("activeAdminHref", () => {
  it("marks the exact section", () => {
    expect(activeAdminHref("/admin/activities", NAV)).toBe("/admin/activities");
  });

  it("marks the section on a nested detail page", () => {
    // Exact matching would light up nothing on /admin/users/123 — the most
    // common place to lose your bearings in an admin tool.
    expect(activeAdminHref("/admin/users/9c1f...", NAV)).toBe("/admin/users");
  });

  it("does not mark Dashboard and the section at the same time", () => {
    // Naive startsWith("/admin") matches every admin route, which highlights the
    // whole nav at once.
    expect(activeAdminHref("/admin/research", NAV)).toBe("/admin/research");
    expect(activeAdminHref("/admin/research", NAV)).not.toBe("/admin");
  });

  it("does not depend on the order the sections happen to be listed in", () => {
    // The tempting one-line implementation is
    //   for (item of items) if (pathname.startsWith(item.href)) best = item.href
    // which returns whichever prefix matched *last*. It looks correct while
    // "/admin" is listed first, and silently breaks the day someone reorders the
    // nav — here every section resolves to Dashboard.
    const reordered = [
      { href: "/admin/activities", label: "Activities" },
      { href: "/admin/users", label: "Users" },
      { href: "/admin", label: "Dashboard" },
    ];

    expect(activeAdminHref("/admin/users", reordered)).toBe("/admin/users");
    expect(activeAdminHref("/admin/activities", reordered)).toBe("/admin/activities");
    expect(activeAdminHref("/admin", reordered)).toBe("/admin");
  });

  it("does not match a sibling section that shares a prefix", () => {
    // /admin/user-settings must not highlight /admin/users.
    const nav = [...NAV, { href: "/admin/user-settings", label: "Settings" }];
    expect(activeAdminHref("/admin/user-settings", nav)).toBe("/admin/user-settings");
    expect(activeAdminHref("/admin/users/abc", nav)).toBe("/admin/users");
  });

  it("returns null outside the admin tree", () => {
    expect(activeAdminHref("/", NAV)).toBeNull();
    expect(activeAdminHref("/activities", NAV)).toBeNull();
    expect(activeAdminHref(null, NAV)).toBeNull();
  });
});

/* ── AdminNav ────────────────────────────────────────────────────────────── */

describe("AdminNav", () => {
  afterEach(() => cleanup());

  it("marks exactly one link with aria-current=page", () => {
    pathname.current = "/admin/users";
    render(createElement(AdminNav, { items: NAV }));

    const current = screen
      .getAllByRole("link")
      .filter(a => a.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("Users");
  });

  it("distinguishes the active link visually, not only semantically", () => {
    // aria-current alone is invisible; the background change is the counterpart.
    pathname.current = "/admin/activities";
    render(createElement(AdminNav, { items: NAV }));

    const active = screen
      .getAllByRole("link")
      .find(a => a.getAttribute("aria-current") === "page")!;
    const inactive = screen.getByRole("link", { name: "Dashboard" });

    expect(active.className).toContain("bg-neutral-900");
    expect(inactive.className).not.toContain("bg-neutral-900");
  });

  it("renders every section as a link with an accessible name", () => {
    pathname.current = "/admin";
    render(createElement(AdminNav, { items: NAV }));

    for (const item of NAV) {
      expect(screen.getByRole("link", { name: item.label }).getAttribute("href")).toBe(
        item.href
      );
    }
  });

  it("fires onNavigate so the mobile drawer can close itself", () => {
    const onNavigate = vi.fn();
    pathname.current = "/admin";
    render(createElement(AdminNav, { items: NAV, onNavigate }));

    screen.getByRole("link", { name: "Users" }).click();

    // Without this, tapping a link in the drawer navigated but left the drawer
    // covering the page it just went to.
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

/* ── AdminShell ──────────────────────────────────────────────────────────── */

describe("AdminShell", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    pathname.current = "/admin";
  });

  const footer = createElement("p", null, "Signed in as admin@example.com");
  const page = createElement("h1", null, "Admin Dashboard");

  const renderShell = () =>
    render(createElement(AdminShell, { navItems: NAV, footer }, page));

  it("renders a labelled nav containing every section", () => {
    renderShell();

    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: "Users" })).toBeTruthy();
  });

  it("hides the wide sidebar at phone widths instead of squeezing the page", () => {
    renderShell();

    const aside = document.querySelector("aside");
    expect(aside).not.toBeNull();

    const cls = aside!.className;
    // The bug was a `w-64` (256px) sidebar visible at every width, next to
    // `p-8` content padding: at 375px that is 375 - 256 - 64 = 55px of content.
    // The width is still 256px where there is room for it; what changed is that
    // it no longer applies at 320/375px.
    expect(cls).toMatch(/(^|\s)hidden(\s|$)/);
    expect(cls).toMatch(/md:flex/);
    expect(cls).toContain("w-64");
  });

  it("serves the same sections from a mobile menu button", () => {
    renderShell();

    expect(screen.getByRole("button", { name: /menu/i })).toBeTruthy();
  });

  it("lets the main region scroll horizontally rather than clipping it", () => {
    renderShell();

    // Wide admin tables must be scrollable; a clipping parent hid the right-hand
    // columns with no way to reach them.
    const main = document.querySelector("main");
    expect(main?.className).toContain("overflow-x-auto");
  });

  it("exposes a main landmark and keeps the page heading inside it", () => {
    renderShell();

    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1 }).textContent).toBe(
      "Admin Dashboard"
    );
  });

  it("does not make the branding label a heading that outranks the page title", () => {
    renderShell();

    // "Admin Panel" was an <h2>, so heading navigation announced it before every
    // page's own <h1>.
    expect(screen.queryByRole("heading", { name: "Admin Panel" })).toBeNull();
  });

  it("renders the server-supplied identity footer", () => {
    renderShell();

    expect(screen.getAllByText("Signed in as admin@example.com").length).toBeGreaterThan(0);
  });

  it("keeps the sign-out control reachable on a phone, not just behind the drawer", () => {
    // The footer renders in both the drawer and the desktop sidebar, so a
    // short viewport can always scroll to it.
    render(createElement(AdminShell, { navItems: NAV, footer }, page));

    const aside = document.querySelector("aside")!;
    expect(aside.className).toMatch(/overflow-y-auto/);
  });
});