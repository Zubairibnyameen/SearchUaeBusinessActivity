"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LoginRequiredDialog } from "@/components/auth/login-required-dialog";
import { AccountSuspendedNotice } from "@/components/auth/account-suspended-notice";

/**
 * Build the same-origin path a signed-in visitor should land on.
 *
 * Only used to seed the form on a page the user is already looking at, so it
 * cannot be used to smuggle an off-origin redirect past
 * `safeNextPath()` — the OAuth callback validates it again server-side.
 */
function localSearchPath(q: string): string {
  return `/search?q=${encodeURIComponent(q)}`;
}

export function SearchBar({
  compact = false,
  /**
   * Whether the visitor is allowed to run a search. Passed down from the
   * server (which knows the real session) — never inferred in the browser, so
   * the client check is purely a UX affordance. Every search endpoint
   * re-authorizes server-side regardless of what this value says.
   */
  canSearch = false,
  /**
   * Pre-populates the input. On /search this is the `?q=` value, so a visitor
   * returning from the OAuth round trip finds their query already in the box
   * and only has to press Search if it did not auto-run.
   */
  initialQuery = "",
  /**
   * The visitor is signed in but their account is suspended. Show the reason
   * rather than a sign-in prompt they could never satisfy.
   */
  suspended = false,
}: {
  compact?: boolean;
  canSearch?: boolean;
  initialQuery?: string;
  suspended?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();
  const [promptSignIn, setPromptSignIn] = useState(false);
  const router = useRouter();

  // The search page streams its `?q=`, so keep the box in sync when it changes
  // (e.g. the OAuth callback redirects back to a different query). Adjusting
  // state during render is React's documented alternative to a syncing effect,
  // and it avoids a render pass that shows the previous query first.
  const [syncedQuery, setSyncedQuery] = useState(initialQuery);
  if (initialQuery !== syncedQuery) {
    setSyncedQuery(initialQuery);
    setQuery(initialQuery);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    // A suspended account is signed in already, so the sign-in dialog would be
    // a dead end: re-authenticating does not lift a suspension, and the OAuth
    // round trip would return the visitor to this same blocked page. The reason
    // is already on screen above the form. This is the same rule
    // `AccountSuspendedNotice` follows by containing no sign-in button.
    if (suspended) return;

    if (!canSearch) {
      // Show the sign-in wall instead of running the search. The attempted
      // query is carried through the OAuth round trip so the user lands back
      // on exactly this search after signing in.
      setPromptSignIn(true);
      return;
    }

    startTransition(() => {
      router.push(localSearchPath(q));
    });
  };

  return (
    <>
      <form
        onSubmit={handleSubmit}
        role="search"
        aria-label="Activity search"
        className={cn("mx-auto w-full", compact ? "max-w-3xl" : "max-w-2xl")}
      >
        <div
          className={cn(
            "group flex items-center gap-2 rounded-xl border border-neutral-300 bg-white p-1.5 shadow-sm transition-all focus-within:border-neutral-400 focus-within:shadow-md",
            !compact && "sm:p-2"
          )}
        >
          <span className="pointer-events-none flex shrink-0 items-center pl-2 text-neutral-500">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className={compact ? "h-4 w-4" : "h-5 w-5"}
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </span>
          <label htmlFor="activity-search" className="sr-only">
            What business activity do you want to start?
          </label>
          <input
            id="activity-search"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="What business activity do you want to start?"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-busy={isPending}
            className={cn(
              "min-w-0 flex-1 bg-transparent font-normal text-neutral-900 placeholder:text-neutral-500 focus:outline-none",
              compact ? "px-1 py-2 text-sm" : "px-2 py-2.5 text-base sm:text-lg"
            )}
          />
          <button
            type="submit"
            // `suspended` is here so the control cannot be pressed at all,
            // rather than being pressable and silently doing nothing. It also
            // blocks implicit submission (Enter in the field), so the only route
            // to a blocked search is the explanation already on screen.
            disabled={isPending || !query.trim() || suspended}
            aria-label={isPending ? "Searching…" : "Search"}
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-neutral-900 font-semibold text-white transition-colors hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 disabled:cursor-not-allowed disabled:opacity-60",
              compact ? "px-4 py-2 text-sm" : "px-6 py-3 text-sm sm:text-base"
            )}
          >
            {isPending && (
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-90"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {isPending ? "Searching…" : "Search"}
          </button>
        </div>
        {suspended ? (
          <p className="mt-2 text-center text-xs text-amber-700">
            Searching is unavailable while your account is suspended.
          </p>
        ) : !canSearch ? (
          <p className="mt-2 text-center text-xs text-neutral-500">
            Searching is free with an account — no card required.
          </p>
        ) : null}
      </form>

      {suspended ? (
        <div className={cn("mx-auto", compact ? "mt-4 max-w-3xl" : "mt-5 max-w-2xl")}>
          <AccountSuspendedNotice variant="inline" />
        </div>
      ) : null}

      <LoginRequiredDialog
        open={promptSignIn}
        onOpenChange={setPromptSignIn}
        nextPath={localSearchPath(query.trim())}
      />
    </>
  );
}
