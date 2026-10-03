// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";

/**
 * The gated-search sign-in surfaces, opened for real.
 *
 * WHY THIS SUITE EXISTS
 *   The search wall offered exactly one authentication method — Google — while
 *   the product also ships email/password sign-up and sign-in. A visitor who
 *   searched without an account was told "Please sign in with Google", which is
 *   both factually wrong and leaves the email path undiscoverable from the one
 *   screen that blocks them.
 *
 *   The bug lived in composition, not in any single auth primitive, so no
 *   existing test covered it: the individual buttons and the auth pages all
 *   still worked. These tests render the genuine components with the genuine
 *   `GoogleSignInButton` and the genuine `safeNextPath` validator — nothing is
 *   stubbed out — so the wording and the option list cannot silently regress.
 *
 *   The redirect safety assertions matter as much as the copy assertions: this
 *   is the screen that decides where a freshly authenticated visitor lands, and
 *   it feeds that value to an external identity provider.
 */

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/search",
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

const signInWithOAuth = vi.hoisted(() => vi.fn());
const buildOAuthCallbackUrl = vi.hoisted(() =>
  vi.fn((_origin: string, nextPath: string) =>
    `https://app.test/auth/callback?next=${encodeURIComponent(nextPath)}`
  )
);

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({
    auth: { signInWithOAuth },
  }),
}));

vi.mock("@/lib/auth/client-origin", () => ({
  buildOAuthCallbackUrl,
  currentBrowserOrigin: () => "https://app.test",
}));

import { LoginRequiredDialog } from "@/components/auth/login-required-dialog";
import { SearchSignInWall } from "@/components/search/search-sign-in-wall";

/** The path `search-bar.tsx` hands the dialog when someone searches signed out. */
const PENDING_QUERY = "/search?q=general%20trading";

function renderDialog(nextPath: string = PENDING_QUERY, onOpenChange = vi.fn()) {
  render(
    createElement(LoginRequiredDialog, {
      open: true,
      onOpenChange,
      nextPath,
    })
  );
  return { onOpenChange };
}

function emailOption(): HTMLAnchorElement {
  const link = screen.getByRole("link", { name: /continue with email/i });
  expect(link.tagName).toBe("A");
  return link as HTMLAnchorElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  buildOAuthCallbackUrl.mockImplementation((_origin: string, nextPath: string) =>
    `https://app.test/auth/callback?next=${encodeURIComponent(nextPath)}`
  );
});

afterEach(() => {
  cleanup();
});

describe("the search sign-in dialog offers every supported method", () => {
  it("offers Google and email, not Google alone", async () => {
    renderDialog();

    expect(
      await screen.findByRole("button", { name: /continue with google/i })
    ).toBeDefined();
    expect(emailOption()).toBeDefined();
  });

  it("separates the two options with an OR divider", async () => {
    renderDialog();

    // `AuthDivider` renders the word uppercase via CSS, so match case-insensitively.
    expect((await screen.findByText(/^or$/i)).textContent?.trim()).toMatch(
      /^or$/i
    );
  });

  it("does not promise Google as the only way in", async () => {
    renderDialog();

    await screen.findByRole("button", { name: /continue with google/i });

    // The stale string is asserted verbatim: this is the exact copy the visitor
    // saw, and re-adding it is the regression being guarded against.
    expect(document.body.textContent).not.toMatch(
      /sign in with Google to search/i
    );
    expect(document.body.textContent).not.toMatch(
      /Sign in with Google and you/i
    );
  });

  it("still names Google explicitly where Google is genuinely meant", async () => {
    renderDialog();

    // The reassurance about Drive/email only applies to the Google path, so it
    // must survive the rewrite rather than being flattened into generic text.
    expect((await screen.findByText(/never post to your Drive/i))).toBeDefined();
  });

  it("closes the dialog when the email option is chosen", async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(emailOption());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("the email option resumes the interrupted search", () => {
  it("points at the existing sign-in page", async () => {
    renderDialog();
    await screen.findByRole("button", { name: /continue with google/i });

    const href = new URL(emailOption().getAttribute("href")!, "https://app.test");
    expect(href.origin).toBe("https://app.test");
    expect(href.pathname).toBe("/signin");
  });

  it("carries the pending query through `next`", async () => {
    renderDialog();
    await screen.findByRole("button", { name: /continue with google/i });

    const href = new URL(emailOption().getAttribute("href")!, "https://app.test");
    // Encoded in the URL, decoded back to the exact same path.
    expect(href.searchParams.get("next")).toBe(PENDING_QUERY);
  });

  it("passes the pending query to the Google option too", async () => {
    renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: /continue with google/i })
    );

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const { redirectTo } = signInWithOAuth.mock.calls[0][0].options;
    const next = new URL(redirectTo).searchParams.get("next");
    expect(next).toBe(PENDING_QUERY);
  });
});

describe("the search dialog refuses an off-origin `next`", () => {
  // A crafted `next` reaching this component would otherwise be handed straight
  // to Google, and would also ride into `/signin?next=`. `safeNextPath()` is
  // applied inside the component precisely so no caller has to be trusted.
  it.each([
    ["an absolute cross-origin URL", "https://evil.example/steal"],
    ["a protocol-relative URL", "//evil.example/steal"],
    ["a backslash-smuggled URL", "/\\evil.example/steal"],
  ])("drops %s from the email link", async (_label, hostile) => {
    renderDialog(hostile);
    await screen.findByRole("button", { name: /continue with google/i });

    const href = new URL(emailOption().getAttribute("href")!, "https://app.test");
    expect(href.searchParams.get("next")).toBe("/");
    expect(emailOption().getAttribute("href")).not.toMatch(/evil\.example/);
  });

  it("never hands a hostile `next` to the Google provider", async () => {
    renderDialog("https://evil.example/steal");

    fireEvent.click(
      await screen.findByRole("button", { name: /continue with google/i })
    );

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const { redirectTo } = signInWithOAuth.mock.calls[0][0].options;
    expect(redirectTo).not.toMatch(/evil\.example/);
    expect(buildOAuthCallbackUrl).toHaveBeenCalledWith("https://app.test", "/");
  });
});

describe("the server-rendered search wall matches", () => {
  it("offers Google and email", () => {
    render(createElement(SearchSignInWall, { nextPath: PENDING_QUERY }));

    expect(
      screen.getByRole("button", { name: /continue with google/i })
    ).toBeDefined();
    expect(emailOption()).toBeDefined();
  });

  it("carries `next` so the visitor lands back on their results", () => {
    render(createElement(SearchSignInWall, { nextPath: PENDING_QUERY }));

    const href = new URL(emailOption().getAttribute("href")!, "https://app.test");
    expect(href.pathname).toBe("/signin");
    expect(href.searchParams.get("next")).toBe(PENDING_QUERY);
  });

  it("drops an off-origin `next`", () => {
    render(
      createElement(SearchSignInWall, { nextPath: "https://evil.example/steal" })
    );

    const href = new URL(emailOption().getAttribute("href")!, "https://app.test");
    expect(href.searchParams.get("next")).toBe("/");
  });

  it("mentions the query it is refusing to show results for", () => {
    render(
      createElement(SearchSignInWall, {
        nextPath: PENDING_QUERY,
        query: "general trading",
      })
    );

    expect(screen.getByText(/general trading/)).toBeDefined();
  });
});

describe("no auth entry point promises Google is the only option", () => {
  // Scoped to the auth and search component trees. This is the whole point of
  // the fix: the inconsistency is a *copy* problem, so the guard has to read the
  // copy rather than only assert on rendered output of components already
  // covered above. Genuinely Google-specific strings (the button label, the
  // Drive reassurance, provider badges) are deliberately absent from this list.
  const STALE = [
    "sign in with Google to search",
    "sign in with Google and you",
    "free with a Google account",
    "We use your Google account only",
  ];

  const roots = ["components/auth", "components/search"];

  it.each(roots)("%s contains no stale single-provider copy", (root) => {
    const dir = join(process.cwd(), "src", ...root.split("/"));

    const offenders: string[] = [];
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, {
        withFileTypes: true,
      }) as unknown as { name: string; isDirectory(): boolean }[]) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(tsx|ts)$/.test(entry.name)) {
          const source = readFileSync(path, "utf8");
          for (const phrase of STALE) {
            if (source.toLowerCase().includes(phrase.toLowerCase())) {
              offenders.push(`${path}: ${phrase}`);
            }
          }
        }
      }
    };
    walk(dir);

    expect(offenders).toEqual([]);
  });
});
