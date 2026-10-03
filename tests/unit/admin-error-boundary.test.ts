// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

/**
 * The admin error boundary.
 *
 * WHY THIS SUITE EXISTS
 *   Before this file, a thrown error anywhere under `/admin` fell through to the
 *   ROOT `app/error.tsx`, which replaced the whole document. An admin who hit a
 *   single failing page lost the sidebar and — the part that actually matters —
 *   the Sign out button, with no way back except browser history.
 *
 *   `app/admin/error.tsx` keeps `admin/layout.tsx` mounted, so the nav and
 *   sign-out survive. It also renders a failure message, which is exactly why it
 *   needs its own test: this is the one admin surface where server detail could
 *   leak straight onto the screen.
 */

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

import AdminError from "@/app/admin/error";

/** A realistic server failure: driver message plus the framework's digest. */
function serverError(): Error & { digest?: string } {
  const err = new Error(
    'column "activity_code" does not exist' +
      " | PostgresError: 42703 at /var/task/node_modules/pg/lib/query.js:118"
  ) as Error & { digest?: string };
  err.digest = "d1g3st-4f2a-11ee-be56-0242ac120002";
  return err;
}

describe("admin error boundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The boundary logs on purpose; keep the test output readable.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  const renderError = (error = serverError()) =>
    render(createElement(AdminError, { error, reset: vi.fn() }));

  it("tells the admin the page failed, in plain language", () => {
    renderError();

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(document.body.textContent).toContain("could not be loaded");
  });

  it("never renders the server error message", () => {
    renderError();

    // The single most important assertion in this file: a driver message and a
    // schema/table name must not reach the browser on an admin page.
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("column");
    expect(text).not.toContain("does not exist");
    expect(text).not.toContain("PostgresError");
    expect(text).not.toContain("node_modules");
    expect(text).not.toContain("pg/lib");
  });

  it("never renders the framework error digest", () => {
    renderError();

    // A digest is an opaque correlation id: useless to an admin, and a handle
    // for probing other requests.
    expect(document.body.textContent ?? "").not.toContain(
      "d1g3st-4f2a-11ee-be56-0242ac120002"
    );
    expect(document.body.textContent ?? "").not.toContain("digest");
  });

  it("logs the detail server-side for the operator instead", () => {
    renderError();

    // The information is not lost, it is just not in the DOM.
    expect(consoleError).toHaveBeenCalled();
  });

  it("offers a retry", () => {
    const reset = vi.fn();
    render(createElement(AdminError, { error: serverError(), reset }));

    act(() => {
      screen.getByRole("button", { name: /try again/i }).click();
    });

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers a way back to the dashboard", () => {
    renderError();

    expect(screen.getByRole("link", { name: /admin dashboard/i }).getAttribute("href")).toBe(
      "/admin"
    );
  });

  it("reassures the admin that the rest of the area is still usable", () => {
    renderError();

    // The boundary exists precisely so this is true.
    expect(document.body.textContent ?? "").toContain("still available");
  });
});