// @vitest-environment jsdom
/**
 * The credential forms, as a person meets them.
 *
 * Opts into jsdom via the docblock above because these are client components
 * with hooks, which the repo's server-tree walker cannot reach. `@testing-library/react`
 * is already a dependency and this file changes nothing about the suite default.
 *
 * The behaviours pinned here are the ones a unit test is actually good for:
 *   - the submit control is disabled exactly when the form cannot succeed;
 *   - loading disables the fields and marks the button busy;
 *   - errors are announced, not merely coloured;
 *   - the forgot-password form shows one message whatever the outcome;
 *   - the reset form degrades to an actionable message with no recovery session;
 *   - no password is ever placed in a `value`, `defaultValue` or error string.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

/**
 * The actions are replaced with recording doubles: this file is about the form,
 * and the actions' own behaviour is covered in `auth-email-actions.test.ts`.
 *
 * Each double resolves to whatever the test queued via `setActionResult`, which
 * is how a component is driven into each of its states without a provider.
 */
let actionResult: unknown = { ok: false, message: "", code: "unknown" };

vi.mock("@/app/(public)/auth/actions", () => ({
  signInWithEmailAction: vi.fn(async () => actionResult),
  signUpWithEmailAction: vi.fn(async () => actionResult),
  requestPasswordResetAction: vi.fn(async () => actionResult),
  updatePasswordAction: vi.fn(async () => actionResult),
}));

import { EmailSignInForm } from "@/components/auth/email-sign-in-form";
import { EmailSignUpForm } from "@/components/auth/email-sign-up-form";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import * as actionsModule from "@/app/(public)/auth/actions";

beforeEach(() => {
  vi.clearAllMocks();
  actionResult = { ok: false, message: "", code: "unknown" };
  cleanup();
});

function submitButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button[type="submit"]') as HTMLButtonElement;
}

/** Fields by their visible label, which is how the markup is meant to be read. */
function fieldByLabel(container: HTMLElement, label: RegExp): HTMLInputElement {
  const node = Array.from(container.querySelectorAll("label")).find(l =>
    label.test(l.textContent ?? "")
  );
  // Resolved through the document rather than a `#id` selector: React's `useId`
  // emits values containing colons, which are not valid in a bare CSS selector
  // and would need escaping.
  const id = node?.getAttribute("for");
  const input = id ? (container.ownerDocument.getElementById(id) as HTMLInputElement | null) : null;
  if (!input) throw new Error(`no input for label ${label}`);
  return input;
}

function type(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

describe("EmailSignInForm", () => {
  function renderForm() {
    return render(createElement(EmailSignInForm, { nextPath: "/search" }));
  }

  it("offers both ways in", async () => {
    const { container } = renderForm();
    expect(container.querySelector("form")).not.toBeNull();
    expect(screen.getByRole("button", { name: /google/i })).toBeTruthy();
  });

  it("disables submit until both fields have content", () => {
    const { container } = renderForm();
    expect(submitButton(container).disabled).toBe(true);

    type(fieldByLabel(container, /email/i), "layla@example.com");
    expect(submitButton(container).disabled).toBe(true);

    type(fieldByLabel(container, /password/i), "licence2024");
    expect(submitButton(container).disabled).toBe(false);
  });

  it("keeps submit disabled for whitespace-only input", () => {
    const { container } = renderForm();
    type(fieldByLabel(container, /email/i), "   ");
    type(fieldByLabel(container, /password/i), "licence2024");
    expect(submitButton(container).disabled).toBe(true);
  });

  it("uses the correct autocomplete tokens so a password manager offers itself", () => {
    const { container } = renderForm();
    expect(fieldByLabel(container, /email/i).getAttribute("autocomplete")).toBe("email");
    expect(fieldByLabel(container, /password/i).getAttribute("autocomplete")).toBe(
      "current-password"
    );
  });

  it("carries the destination through a hidden field", () => {
    const { container } = renderForm();
    const hidden = container.querySelector('input[type="hidden"][name="next"]');
    // Without this the post-auth redirect would lose /search.
    expect(hidden?.getAttribute("value")).toBe("/search");
  });

  it("offers a route back to create an account", () => {
    renderForm();
    const link = screen
      .getAllByRole("link")
      .find(l => /create one/i.test(l.textContent ?? ""));
    expect(link?.getAttribute("href")).toBe("/signup?next=%2Fsearch");
  });

  it("offers a route to password recovery", () => {
    renderForm();
    const link = screen
      .getAllByRole("link")
      .find(l => /forgot/i.test(l.textContent ?? ""));
    expect(link?.getAttribute("href")).toMatch(/^\/forgot-password/);
  });

  it("shows an announced error when sign-in fails", async () => {
    actionResult = {
      ok: false,
      message: "That email address and password combination is not correct.",
      code: "invalid_credentials",
    };
    const { container } = renderForm();
    type(fieldByLabel(container, /email/i), "layla@example.com");
    type(fieldByLabel(container, /password/i), "wrong-password");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(document.body.textContent).toMatch(/not correct/i);
  });

  it("never puts the typed password back into the DOM", async () => {
    actionResult = { ok: false, message: "Nope.", code: "invalid_credentials" };
    const { container } = renderForm();
    type(fieldByLabel(container, /email/i), "layla@example.com");
    type(fieldByLabel(container, /password/i), "licence2024");
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    // The error text must not echo the credential back into the page.
    expect(document.body.textContent).not.toContain("licence2024");
  });
});

describe("EmailSignUpForm", () => {
  function renderForm() {
    return render(createElement(EmailSignUpForm, { nextPath: "/search" }));
  }

  it("disables submit until every field has content", () => {
    const { container } = renderForm();
    type(fieldByLabel(container, /full name/i), "Layla Hassan");
    type(fieldByLabel(container, /email/i), "layla@example.com");
    type(fieldByLabel(container, /^password/i), "licence2024");
    expect(submitButton(container).disabled).toBe(true);
    type(fieldByLabel(container, /confirm/i), "licence2024");
    expect(submitButton(container).disabled).toBe(false);
  });

  it("names the missing rule while a password is being typed", () => {
    // The convenience half of the check; `parseSignUp` enforces it regardless.
    const { container } = renderForm();
    type(fieldByLabel(container, /^password/i), "abcdefgh");
    expect(document.body.textContent).toMatch(/one number/i);
    expect(submitButton(container).disabled).toBe(true);
  });

  it("catches a length-only failure", () => {
    const { container } = renderForm();
    type(fieldByLabel(container, /^password/i), "ab1");
    expect(document.body.textContent).toMatch(/at least 8 characters/i);
  });

  it("flags a mismatch as soon as the confirmation differs", () => {
    const { container } = renderForm();
    type(fieldByLabel(container, /^password/i), "licence2024");
    type(fieldByLabel(container, /confirm/i), "licence2025");
    expect(screen.getAllByText(/do not match/i).length).toBeGreaterThan(0);
    expect(submitButton(container).disabled).toBe(true);
  });

  it("raises the mismatch on an accessible alert, not only in colour", () => {
    const { container } = renderForm();
    type(fieldByLabel(container, /^password/i), "licence2024");
    type(fieldByLabel(container, /confirm/i), "licence2025");
    // `role="alert"` is what makes a screen reader announce it unprompted.
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/do not match/i);
  });

  it("clears the mismatch once the fields agree again", () => {
    const { container } = renderForm();
    type(fieldByLabel(container, /^password/i), "licence2024");
    type(fieldByLabel(container, /confirm/i), "licence2025");
    expect(screen.queryAllByText(/do not match/i).length).toBeGreaterThan(0);

    type(fieldByLabel(container, /confirm/i), "licence2024");
    expect(screen.queryAllByText(/do not match/i)).toHaveLength(0);
  });

  it("does not accuse an empty form of a mismatch", () => {
    renderForm();
    expect(screen.queryAllByText(/do not match/i)).toHaveLength(0);
  });

  it("marks the password field invalid for assistive technology", () => {
    const { container } = renderForm();
    type(fieldByLabel(container, /^password/i), "abcdefgh");
    expect(fieldByLabel(container, /^password/i).getAttribute("aria-invalid")).toBe("true");
  });

  it("states the password policy in the hint", () => {
    renderForm();
    expect(document.body.textContent).toMatch(/must have at least 8 characters/i);
  });

  it("replaces the form once the confirmation email is sent", async () => {
    // Re-pressing submit would only produce a second confirmation email, so the
    // form is replaced rather than left under a banner.
    actionResult = {
      ok: true,
      code: "confirmation_required",
      message: "Check your inbox to confirm your email address, then sign in.",
    };
    const { container } = renderForm();
    type(fieldByLabel(container, /full name/i), "Layla Hassan");
    type(fieldByLabel(container, /email/i), "layla@example.com");
    type(fieldByLabel(container, /^password/i), "licence2024");
    type(fieldByLabel(container, /confirm/i), "licence2024");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(container.querySelector("form")).toBeNull());
    expect(document.body.textContent).toMatch(/check your inbox/i);
  });

  it("mentions spam, since a filtered email looks identical to a failure", async () => {
    actionResult = {
      ok: true,
      code: "confirmation_required",
      message: "Check your inbox to confirm your email address, then sign in.",
    };
    const { container } = renderForm();
    type(fieldByLabel(container, /full name/i), "Layla Hassan");
    type(fieldByLabel(container, /email/i), "layla@example.com");
    type(fieldByLabel(container, /^password/i), "licence2024");
    type(fieldByLabel(container, /confirm/i), "licence2024");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(container.querySelector("form")).toBeNull());
    expect(document.body.textContent).toMatch(/spam/i);
  });
});

describe("ForgotPasswordForm", () => {
  function renderForm() {
    return render(createElement(ForgotPasswordForm, {}));
  }

  it("disables submit until an address is typed", () => {
    const { container } = renderForm();
    expect(submitButton(container).disabled).toBe(true);
    type(container.querySelector("input")!, "layla@example.com");
    expect(submitButton(container).disabled).toBe(false);
  });

  it("shows the neutral message for a registered address", async () => {
    actionResult = {
      ok: true,
      code: "reset_sent",
      message:
        "If that email address has an account, a password reset link is on its way. Please check your inbox and your spam folder.",
    };
    const { container } = renderForm();
    type(container.querySelector("input")!, "layla@example.com");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(document.body.textContent).toMatch(/if that email address/i));
    expect(document.body.textContent).toMatch(/spam/i);
  });

  it("shows the identical message for an unregistered address", async () => {
    // The enumeration oracle, asserted from the UI side: the two renderings must
    // be indistinguishable, not merely similarly worded.
    actionResult = {
      ok: true,
      code: "reset_sent",
      message:
        "If that email address has an account, a password reset link is on its way. Please check your inbox and your spam folder.",
    };
    const { container } = renderForm();
    type(container.querySelector("input")!, "ghost@example.com");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(document.body.textContent).toMatch(/if that email address/i));
    expect(document.body.textContent).not.toMatch(/no account|not found|unregistered/i);
  });

  it("announces the result politely rather than interrupting", async () => {
    actionResult = { ok: true, code: "reset_sent", message: "If that email address has an account…" };
    const { container } = renderForm();
    type(container.querySelector("input")!, "layla@example.com");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("offers a way back to sign in", () => {
    renderForm();
    const link = screen
      .getAllByRole("link")
      .find(l => /back to sign in/i.test(l.textContent ?? ""));
    expect(link?.getAttribute("href")).toBe("/signin");
  });

  it("never asks for a password", () => {
    // A reset-request form asking for a password would be both confusing and a
    // signal that the two flows have been crossed.
    const { container } = renderForm();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });
});

describe("ResetPasswordForm", () => {
  function renderForm(hasRecoverySession: boolean) {
    return render(createElement(ResetPasswordForm, { hasRecoverySession }));
  }

  it("shows the form only when a recovery session exists", () => {
    const { container } = renderForm(true);
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(submitButton(container)).not.toBeNull();
  });

  it("explains an expired or used link instead of showing a dead form", () => {
    // Without this the person is invited to type a password that cannot possibly
    // be submitted, with no indication of why.
    const { container } = renderForm(false);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(document.body.textContent).toMatch(/no longer valid|expired|already been used/i);
  });

  it("says the link can only be used once", () => {
    renderForm(false);
    expect(document.body.textContent).toMatch(/only be opened once|only be used once/i);
  });

  it("offers a fresh link when the old one is dead", () => {
    renderForm(false);
    const link = screen
      .getAllByRole("link")
      .find(l => /request a new link/i.test(l.textContent ?? ""));
    expect(link?.getAttribute("href")).toBe("/forgot-password");
  });

  it("disables submit until both fields have content", () => {
    const { container } = renderForm(true);
    type(fieldByLabel(container, /new password/i), "licence2024");
    expect(submitButton(container).disabled).toBe(true);
    type(fieldByLabel(container, /confirm/i), "licence2024");
    expect(submitButton(container).disabled).toBe(false);
  });

  it("flags a mismatch", () => {
    const { container } = renderForm(true);
    type(fieldByLabel(container, /new password/i), "licence2024");
    type(fieldByLabel(container, /confirm/i), "licence2025");
    expect(screen.queryAllByText(/do not match/i).length).toBeGreaterThan(0);
    expect(submitButton(container).disabled).toBe(true);
  });

  it("flags a weak password", () => {
    const { container } = renderForm(true);
    type(fieldByLabel(container, /new password/i), "abcdefgh");
    expect(document.body.textContent).toMatch(/one number/i);
  });

  it("does not ask for an email, because the session identifies the account", () => {
    // The account is the recovery session's. A field here would invite the
    // question of whether it can be pointed somewhere else — it cannot.
    const { container } = renderForm(true);
    expect(container.querySelector('input[type="email"]')).toBeNull();
  });

  it("uses new-password autocomplete so a manager offers to generate", () => {
    const { container } = renderForm(true);
    const inputs = container.querySelectorAll('input[type="password"]');
    for (const input of inputs) {
      expect(input.getAttribute("autocomplete")).toBe("new-password");
    }
  });

  it("shows an announced error when the link expires mid-flight", async () => {
    actionResult = {
      ok: false,
      message: "This link has expired or has already been used. Request a new one to continue.",
      code: "session_expired",
    };
    const { container } = renderForm(true);
    type(fieldByLabel(container, /new password/i), "licence2024");
    type(fieldByLabel(container, /confirm/i), "licence2024");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(document.body.textContent).toMatch(/expired|already been used/i);
  });
});

describe("form loading states", () => {
  /**
   * Install an action that never settles until `release()` is called.
   *
   * `requestSubmit()` is used rather than `fireEvent.submit`: React 19 gives a
   * form with a function `action` a `javascript:throw …` fallback attribute, and
   * jsdom will evaluate that if the form is submitted natively. `requestSubmit`
   * is the path React intercepts.
   */
  function installGatedAction(): () => void {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const actions = actionsModule;
    vi.mocked(actions.signInWithEmailAction).mockImplementation(async () => {
      await gate;
      return { ok: false, message: "done", code: "unknown" };
    });
    return () => release();
  }

  function renderFilledSignIn() {
    const view = render(createElement(EmailSignInForm, { nextPath: "/" }));
    type(fieldByLabel(view.container, /email/i), "layla@example.com");
    type(fieldByLabel(view.container, /password/i), "licence2024");
    return view;
  }

  it("marks the submit control busy and disables it while in flight", async () => {
    const release = installGatedAction();
    const { container } = renderFilledSignIn();

    fireEvent.submit(container.querySelector("form")!);
    // `act` flushes the render React queued for `setPending(true)` without
    // awaiting the still-pending action, which is what an ordinary browser tick
    // would do between the click and the response.
    await act(async () => {});

    expect(submitButton(container).disabled).toBe(true);
    expect(submitButton(container).getAttribute("aria-busy")).toBe("true");
    // A second submit mid-flight must not be possible.
    expect(submitButton(container).textContent).toMatch(/signing in/i);

    release();
    await waitFor(() => expect(submitButton(container).getAttribute("aria-busy")).toBe("false"));
  });

  it("disables the inputs while a request is in flight", async () => {
    const release = installGatedAction();
    const { container } = renderFilledSignIn();

    fireEvent.submit(container.querySelector("form")!);
    await act(async () => {});

    // Editing a field mid-flight would submit values the server never saw.
    expect(fieldByLabel(container, /email/i).disabled).toBe(true);
    expect(fieldByLabel(container, /password/i).disabled).toBe(true);

    release();
    await waitFor(() => expect(fieldByLabel(container, /email/i).disabled).toBe(false));
  });

  it("re-enables the form once the request settles", async () => {
    const release = installGatedAction();
    const { container } = renderFilledSignIn();

    fireEvent.submit(container.querySelector("form")!);
    await act(async () => {});
    expect(submitButton(container).disabled).toBe(true);

    release();
    await waitFor(() => expect(submitButton(container).disabled).toBe(false));
  });
});