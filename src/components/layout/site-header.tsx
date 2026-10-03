import Link from "next/link";
import { HeaderAuth } from "@/components/auth/header-auth";

const NAV_ITEMS = [
  { href: "/search", label: "Search Activities" },
  { href: "/activities", label: "Browse Activities" },
  { href: "/jurisdictions", label: "Jurisdictions" },
  { href: "/compare", label: "Compare" },
];

/**
 * Site header.
 *
 * RESPONSIVE BEHAVIOUR
 *   The row is a single flex line with no wrapping, so anything that cannot
 *   shrink forces the whole header wider than the viewport and pushes the
 *   trailing content off-screen. The account control is the one thing that must
 *   never be lost — it is the only route to /account, /account/profile and sign
 *   out — so it is pinned with `shrink-0` and everything to its left is allowed
 *   to give way instead: the wordmark collapses to the mark on the narrowest
 *   screens, and the nav scrolls inside its own track rather than pushing.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-6 sm:gap-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight text-neutral-900"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-900">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
              <path
                d="M10 2.5 16.5 5v4.2c0 3.9-2.8 7.1-6.5 8.3-3.7-1.2-6.5-4.4-6.5-8.3V5L10 2.5z"
                stroke="white"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <circle cx="10" cy="8.6" r="1.6" fill="white" />
            </svg>
          </span>
          <span className="hidden text-[15px] sm:inline">
            UAE Activity Intelligence
          </span>
          <span className="sr-only sm:hidden">UAE Activity Intelligence</span>
        </Link>
        {/* `min-w-0` lets this group shrink below its content width; without it
            the default `min-width: auto` on a flex item re-introduces the very
            overflow the parent is trying to avoid. */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
          <nav
            aria-label="Main"
            className="flex min-w-0 items-center gap-1 overflow-x-auto sm:gap-2"
          >
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 sm:px-3"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {/* Pinned last and never shrunk, so the account menu stays reachable
              however narrow the viewport gets. */}
          <div className="shrink-0">
            <HeaderAuth />
          </div>
        </div>
      </div>
    </header>
  );
}
