// @vitest-environment jsdom
/**
 * `SearchBar` on `/search` — the one audited surface that must behave
 * differently for a suspended session than for an anonymous one.
 *
 * WHY jsdom HERE AND NOW
 *   `SearchBar` is a client component with hooks, so the repo's hand-rolled
 *   server-tree walker cannot reach it — calling it as a plain function would
 *   invoke `useState` outside a React runtime. `@testing-library/react` is
 *   already a dependency, and this one file opts into jsdom via the docblock
 *   above rather than changing the suite-wide `environment: "node"`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { SearchBar } from "@/components/search/search-bar";

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

function renderBar(props: Record<string, unknown> = {}) {
  return render(
    createElement(SearchBar, { initialQuery: "trading licence", ...props })
  );
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button[type="submit"]') as HTMLButtonElement;
}

describe("SearchBar — suspended visitor", () => {
  it("explains the suspension instead of prompting for sign-in", () => {
    renderBar({ canSearch: false, suspended: true });
    expect(screen.getByText(/unavailable while your account is suspended/i)).toBeTruthy();
  });

  it("disables the submit control, so a blocked search is not reachable", () => {
    const { container } = renderBar({ canSearch: false, suspended: true });
    expect(submitButton(container).disabled).toBe(true);
  });

  it("does not open the sign-in dialog on submit", () => {
    const { container } = renderBar({ canSearch: false, suspended: true });
    // A suspended visitor is already signed in, so the dialog is a dead end:
    // re-authenticating cannot lift a suspension, and the OAuth round trip
    // would return them to this same blocked page.
    fireEvent.submit(container.querySelector("form")!);
    expect(document.body.textContent).not.toMatch(/sign in to search activities/i);
  });

  it("still links to the account route, which a suspended account may read", () => {
    renderBar({ canSearch: false, suspended: true });
    const accountLinks = screen
      .getAllByRole("link")
      .filter(l => l.getAttribute("href") === "/account");
    expect(accountLinks.length).toBeGreaterThan(0);
  });

  it("renders no second sign-in affordance anywhere in the form", () => {
    renderBar({ canSearch: false, suspended: true });
    // `AccountSuspendedNotice` deliberately carries no sign-in button; the
    // dialog this guards was the one place that rule was being broken.
    expect(screen.queryAllByRole("button", { name: /sign in/i })).toHaveLength(0);
  });

  it("keeps the query in the box so it is not lost", () => {
    const { container } = renderBar({ canSearch: false, suspended: true });
    const input = container.querySelector("input")! as HTMLInputElement;
    expect(input.value).toBe("trading licence");
  });
});

describe("SearchBar — active visitor", () => {
  it("leaves the control enabled", () => {
    const { container } = renderBar({ canSearch: true, suspended: false });
    expect(submitButton(container).disabled).toBe(false);
  });

  it("disables the control for a blank query", () => {
    const { container } = renderBar({ canSearch: true, suspended: false, initialQuery: "  " });
    expect(submitButton(container).disabled).toBe(true);
  });

  it("offers no suspension message", () => {
    renderBar({ canSearch: true, suspended: false });
    expect(screen.queryByText(/unavailable while your account is suspended/i)).toBeNull();
  });
});

describe("SearchBar — anonymous visitor", () => {
  it("keeps the sign-in dialog available, unlike the suspended case", () => {
    // Anonymous is a real, satisfiable dead end, so the wall must stay. This is
    // the control that proves the suspended fix did not simply disable the wall.
    const { container } = renderBar({ canSearch: false, suspended: false });
    fireEvent.submit(container.querySelector("form")!);
    expect(document.body.textContent).toMatch(/sign in to search activities/i);
  });
});
