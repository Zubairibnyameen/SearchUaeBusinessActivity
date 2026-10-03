import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";

import { renderElement } from "../helpers/render";

/**
 * The site header at a narrow viewport.
 *
 * WHY THIS SUITE EXISTS
 *   The header row is a single non-wrapping flex line. Anything on it that
 *   cannot shrink therefore makes the whole header wider than the phone
 *   viewport, and whatever sits at the trailing edge is pushed out of reach.
 *   The trailing edge here is the account control — the only route to
 *   /account, /account/profile and sign out — so a signed-in mobile visitor
 *   could not reach their own account at all.
 *
 *   `HeaderAuth` is left real: the walker awaits async server components, so the
 *   genuine session branch runs here. Only `UserMenu` is stubbed, because it is
 *   a client component with hooks that the walker cannot invoke, and the
 *   dropdown primitive needs layout jsdom does not implement. The classes are
 *   the subject under test, since layout is expressed as classes and jsdom
 *   performs no layout.
 */
vi.mock("server-only", () => ({}));

/** The resolved session, flipped per test. `getViewer` reads it at call time. */
const session = vi.hoisted(() => ({
  viewer: null as unknown,
  nextPath: "/",
}));

vi.mock("@/lib/auth/viewer", () => ({
  getViewer: async () => session.viewer,
}));

vi.mock("@/components/auth/user-menu", () => ({
  UserMenu: () =>
    createElement("button", { type: "button", "data-testid": "account-control" }, "account"),
  SignInButton: (props: Record<string, unknown>) =>
    createElement(
      "a",
      { href: `/signin?next=${encodeURIComponent(String(props.nextPath))}` },
      "Sign in"
    ),
}));

// `className` has to survive, or the layout assertions below would be checking
// that an empty object is an empty object.
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

import { SiteHeader } from "@/components/layout/site-header";

const SIGNED_IN = {
  email: "layla@example.com",
  fullName: "Layla Haddad",
  avatarUrl: null,
  isAdmin: false,
};

function renderHeader() {
  return renderElement(SiteHeader());
}

function classesOf(node: { props: Record<string, unknown> } | undefined): string {
  const value = node?.props.className;
  return typeof value === "string" ? value : "";
}

beforeEach(() => {
  vi.clearAllMocks();
  session.viewer = SIGNED_IN;
  session.nextPath = "/";
});

describe("SiteHeader — the account control must never be the thing that yields", () => {
  it("renders the account control for a signed-in visitor", async () => {
    const { nodes } = await renderHeader();
    expect(nodes.some(n => n.props["data-testid"] === "account-control")).toBe(true);
  });

  it("pins the account control with shrink-0", async () => {
    const { nodes } = await renderHeader();
    const at = nodes.findIndex(n => n.props["data-testid"] === "account-control");
    expect(at).toBeGreaterThan(-1);
    // `HeaderAuth` is an async component, so the wrapper's `children` is still
    // the un-invoked element. Nodes are recorded in document order, so the
    // nearest preceding `div` is the wrapper the control is pinned inside.
    let wrapper;
    for (let i = at - 1; i >= 0; i--) {
      if (nodes[i].type === "div") {
        wrapper = nodes[i];
        break;
      }
    }
    expect(classesOf(wrapper)).toMatch(/shrink-0/);
  });

  it("does not pin the header row itself, which is what forced overflow", async () => {
    const { nodes } = await renderHeader();
    const row = nodes.find(n => n.type === "div" && classesOf(n).includes("h-14"));
    expect(row).toBeDefined();
    expect(classesOf(row)).not.toMatch(/(^|\s)shrink-0(\s|$)/);
  });

  it("lets the row's trailing group shrink below its content width", async () => {
    const { nodes } = await renderHeader();
    // A flex item defaults to `min-width: auto`, which refuses to shrink below
    // its content. Without `min-w-0` the rest of the fix has no effect.
    const group = nodes.find(n => n.type === "div" && classesOf(n).includes("flex-1"));
    expect(classesOf(group)).toMatch(/min-w-0/);
  });

  it("lets the primary nav scroll rather than push", async () => {
    const { nodes } = await renderHeader();
    const nav = nodes.find(n => n.type === "nav");
    expect(classesOf(nav)).toMatch(/overflow-x-auto/);
    expect(classesOf(nav)).toMatch(/min-w-0/);
  });

  it("keeps the nav items themselves from being squashed", async () => {
    const { nodes } = await renderHeader();
    const links = nodes.filter(
      n => n.type === "a" && typeof n.props.href === "string" && n.props.href !== "/"
    );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(classesOf(link)).toMatch(/shrink-0/);
    }
  });
});

describe("SiteHeader — navigation content", () => {
  it("still exposes every primary destination on a narrow screen", async () => {
    const { hrefs } = await renderHeader();
    for (const href of ["/search", "/activities", "/jurisdictions", "/compare"]) {
      expect(hrefs).toContain(href);
    }
  });

  it("links the wordmark home without producing a protocol-relative URL", async () => {
    const { hrefs } = await renderHeader();
    expect(hrefs).toContain("/");
    expect(hrefs).not.toContain("//");
  });

  it("keeps the wordmark readable to screen readers once the text is hidden", async () => {
    const { nodes } = await renderHeader();
    // Below `sm` the visible wordmark is `hidden`, so a visually-hidden copy has
    // to carry the accessible name or the logo link becomes unlabelled.
    const srOnly = nodes
      .filter(n => classesOf(n).includes("sr-only"))
      .map(n => n.text);
    expect(srOnly).toContain("UAE Activity Intelligence");
  });
});

describe("HeaderAuth — the session is resolved server-side", () => {
  it("shows the account menu for a signed-in visitor", async () => {
    const { nodes } = await renderHeader();
    expect(nodes.some(n => n.props["data-testid"] === "account-control")).toBe(true);
  });

  it("offers sign-in to an anonymous visitor", async () => {
    session.viewer = null;
    const { hrefs, text } = await renderHeader();
    expect(text).toMatch(/Sign in/);
    // Same-origin only: `next` is URL-encoded, never interpolated raw.
    expect(hrefs).toContain("/signin?next=%2F");
  });
});
