// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

/**
 * The account dropdown, opened for real.
 *
 * WHY THIS SUITE EXISTS
 *   `site-header.test.ts` stubs `UserMenu` out — the dropdown primitive needs
 *   layout jsdom does not implement. That stub is exactly why this crash reached
 *   production: the only consumer of `DropdownMenuLabel` was never actually
 *   rendered by any test.
 *
 *   The wrapper was a shadcn/Radix port in which `DropdownMenuLabel` was a
 *   standalone div. It was mapped onto Base UI's `Menu.GroupLabel`, which reads
 *   `MenuGroupContext` unconditionally and throws
 *   "Base UI: MenuGroupContext is missing." outside a `Menu.Group` /
 *   `Menu.RadioGroup`. `UserMenu` renders a bare header above a separator, so it
 *   has no group to provide that context.
 *
 *   These tests therefore render the genuine `UserMenu` with the genuine Base UI
 *   primitives and actually open the menu — no stubbing of the dropdown — so the
 *   exception cannot come back unnoticed.
 */

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: unknown;
    [key: string]: unknown;
  }) => createElement("a", { href, ...rest }, children as never),
}));

import { UserMenu } from "@/components/auth/user-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const VIEWER = {
  email: "layla@example.com",
  fullName: "Layla Hassan",
  avatarUrl: null,
  isAdmin: false,
};

/** jsdom implements neither of these, and the positioning layer asks for both. */
function polyfill(name: string, value: unknown) {
  if (typeof (globalThis as Record<string, unknown>)[name] === "undefined") {
    (globalThis as Record<string, unknown>)[name] = value;
  }
}

beforeEach(() => {
  polyfill("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  polyfill("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  });
  polyfill("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Open a rendered trigger and wait for the popup.
 *
 * `waitFor` is what makes this a real regression test rather than a smoke test:
 * Base UI throws from inside a layout effect, so the failure surfaces after the
 * click has already been handled. An unhandled React error would otherwise be
 * reported asynchronously and could be missed.
 */
async function openMenu(triggerName: RegExp = /account menu/i) {
  const trigger = screen.getByRole("button", { name: triggerName });
  await act(async () => {
    fireEvent.click(trigger);
  });
  await waitFor(() => {
    expect(screen.getByRole("menu")).toBeTruthy();
  });
  return screen.getByRole("menu");
}

/** The `UserMenu` trigger's accessible name, for the synthetic compositions. */
const SYNTHETIC_TRIGGER = /open/i;

/**
 * React 19 dropped the implicit `data-*` allowance from component prop types,
 * and Base UI's `Props` types list every key they accept. Test ids are therefore
 * spread in through a typed record rather than written into the object literal,
 * which keeps the wrappers' prop types strict instead of widening them to
 * `Record<string, unknown>` just to make a test convenient.
 */
function tid(id: string): Record<string, string> {
  return { "data-testid": id };
}

describe("UserMenu opens without a MenuGroupContext error", () => {
  it("does not throw the MenuGroupContext error when opened", async () => {
    // The exact production failure. Asserted on the message so an unrelated
    // Base UI error cannot make this test pass.
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.message);
    };
    window.addEventListener("error", onError);

    try {
      render(createElement(UserMenu, { user: VIEWER }));
      await openMenu();
      expect(errors.join("\n")).not.toMatch(/MenuGroupContext is missing/);
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("renders every menu item once open", async () => {
    render(createElement(UserMenu, { user: VIEWER }));
    await openMenu();
    for (const name of [/profile/i, /account/i, /search activities/i, /sign out/i]) {
      expect(screen.getByRole("menuitem", { name })).toBeTruthy();
    }
  });

  it("shows the signed-in identity in the header", async () => {
    render(createElement(UserMenu, { user: VIEWER }));
    await openMenu();
    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("Layla Hassan");
    expect(menu.textContent).toContain("layla@example.com");
  });

  it("falls back to a neutral header when there is no name", async () => {
    render(createElement(UserMenu, { user: { ...VIEWER, fullName: null } }));
    const menu = await openMenu();
    expect(menu.textContent).toContain("Signed in");
  });

  it("offers the admin links only to an admin", async () => {
    render(createElement(UserMenu, { user: { ...VIEWER, isAdmin: true } }));
    await openMenu();
    expect(screen.getByRole("menuitem", { name: /admin profile/i })).toBeTruthy();
  });

  it("omits the admin links from a normal user's menu", async () => {
    render(createElement(UserMenu, { user: VIEWER }));
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: /admin profile/i })).toBeNull();
  });

  it("links the profile item to the profile route", async () => {
    render(createElement(UserMenu, { user: VIEWER }));
    await openMenu();
    expect(screen.getByRole("menuitem", { name: /profile/i }).getAttribute("href")).toBe(
      "/account/profile"
    );
  });

  it("marks the destructive sign-out item", async () => {
    // The visual distinction is carried entirely by a data attribute.
    render(createElement(UserMenu, { user: VIEWER }));
    await openMenu();
    const signOut = screen.getByRole("menuitem", { name: /sign out/i });
    expect(signOut.getAttribute("data-variant")).toBe("destructive");
  });

  it("signs out through the server route", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    render(createElement(UserMenu, { user: VIEWER }));
    await openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/auth/signout", { method: "POST" });
    });
    expect(router.refresh).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("DropdownMenuLabel is a standalone header, not a group label", () => {
  it("renders outside any group without throwing", async () => {
    // This is the composition `UserMenu` uses, and the one that used to crash.
    render(
      createElement(
        DropdownMenu,
        null,
        createElement(DropdownMenuTrigger, { render: createElement("button") }, "open"),
        createElement(
          DropdownMenuContent,
          null,
          createElement(DropdownMenuLabel, null, "Header only"),
          createElement(DropdownMenuSeparator, null),
          createElement(DropdownMenuItem, null, "Item")
        )
      )
    );
    await openMenu(SYNTHETIC_TRIGGER);
    expect(screen.getByRole("menu").textContent).toContain("Header only");
  });

  it("is a plain element with no menu role of its own", async () => {
    render(
      createElement(
        DropdownMenu,
        null,
        createElement(DropdownMenuTrigger, { render: createElement("button") }, "open"),
        createElement(
          DropdownMenuContent,
          null,
          createElement(DropdownMenuLabel, tid("hdr"), "Header"),
          createElement(DropdownMenuItem, null, "Item")
        )
      )
    );
    await openMenu(SYNTHETIC_TRIGGER);
    const label = screen.getByTestId("hdr");
    // `role="presentation"` keeps the header from being an invalid child of
    // `role="menu"`, which only permits menuitem/group/separator.
    expect(label.getAttribute("role")).toBe("presentation");
    expect(label.tagName).toBe("DIV");
  });

  it("does not name any group", async () => {
    // The header must NOT become the accessible name of the items below it:
    // it identifies the person, not a section of the menu.
    render(
      createElement(
        DropdownMenu,
        null,
        createElement(DropdownMenuTrigger, { render: createElement("button") }, "open"),
        createElement(
          DropdownMenuContent,
          null,
          createElement(DropdownMenuLabel, tid("hdr"), "Layla Hassan"),
          createElement(DropdownMenuGroup, tid("grp"),
            createElement(DropdownMenuItem, null, "Item"))
        )
      )
    );
    await openMenu(SYNTHETIC_TRIGGER);
    expect(screen.getByTestId("grp").getAttribute("aria-labelledby")).toBeNull();
  });

  it("keeps the inset hook for aligned layouts", async () => {
    render(
      createElement(
        DropdownMenu,
        null,
        createElement(DropdownMenuTrigger, { render: createElement("button") }, "open"),
        createElement(
          DropdownMenuContent,
          null,
          createElement(DropdownMenuLabel, { inset: true, ...tid("hdr") }, "H"),
          createElement(DropdownMenuItem, null, "Item")
        )
      )
    );
    await openMenu(SYNTHETIC_TRIGGER);
    expect(screen.getByTestId("hdr").getAttribute("data-inset")).toBe("true");
  });
});

describe("DropdownMenuGroupLabel labels the group it is inside", () => {
  it("renders inside a group and names it", async () => {
    render(
      createElement(
        DropdownMenu,
        null,
        createElement(DropdownMenuTrigger, { render: createElement("button") }, "open"),
        createElement(
          DropdownMenuContent,
          null,
          createElement(
            DropdownMenuGroup,
            tid("grp"),
            createElement(DropdownMenuGroupLabel, null, "Account actions"),
            createElement(DropdownMenuItem, null, "Profile")
          )
        )
      )
    );
    const menu = await openMenu(SYNTHETIC_TRIGGER);
    expect(menu.textContent).toContain("Account actions");

    const group = screen.getByTestId("grp");
    const labelledBy = group.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    // The association must resolve to the label's own text, which is what
    // Base UI wires up through the group's label-id state.
    expect(document.getElementById(labelledBy as string)?.textContent).toBe(
      "Account actions"
    );
  });

  it("renders inside a radio group too", async () => {
    // `Menu.RadioGroup` also supplies the group context.
    render(
      createElement(
        DropdownMenu,
        null,
        createElement(DropdownMenuTrigger, { render: createElement("button") }, "open"),
        createElement(
          DropdownMenuContent,
          null,
          createElement(
            DropdownMenuRadioGroup,
            { value: "a", ...tid("grp") },
            createElement(DropdownMenuGroupLabel, null, "Choices"),
            createElement(DropdownMenuRadioItem, { value: "a" }, "One"),
            createElement(DropdownMenuRadioItem, { value: "b" }, "Two")
          )
        )
      )
    );
    const menu = await openMenu(SYNTHETIC_TRIGGER);
    expect(menu.textContent).toContain("Choices");
    const group = screen.getByTestId("grp");
    expect(
      document.getElementById(group.getAttribute("aria-labelledby") as string)?.textContent
    ).toBe("Choices");
  });

  it("carries its own data-slot, distinct from the standalone header", async () => {
    render(
      createElement(
        DropdownMenu,
        null,
        createElement(DropdownMenuTrigger, { render: createElement("button") }, "open"),
        createElement(
          DropdownMenuContent,
          null,
          createElement(
            DropdownMenuGroup,
            null,
            createElement(
              DropdownMenuGroupLabel,
              tid("glabel"),
              "Section"
            ),
            createElement(DropdownMenuItem, null, "Item")
          )
        )
      )
    );
    await openMenu(SYNTHETIC_TRIGGER);
    expect(screen.getByTestId("glabel").getAttribute("data-slot")).toBe(
      "dropdown-menu-group-label"
    );
  });
});