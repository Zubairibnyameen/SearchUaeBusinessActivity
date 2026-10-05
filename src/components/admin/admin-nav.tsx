"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The admin section navigation.
 *
 * WHY THIS IS A CLIENT COMPONENT
 *   A server component cannot read the current pathname, so a server-rendered
 *   nav has no way to mark which section you are in. The result was twelve
 *   links that looked identical on every screen, with nothing telling an admin
 *   where they were — and no `aria-current`, so a screen-reader user navigating
 *   by links could not tell either.
 *
 *   `usePathname()` is the only thing needed, and marking the active link is
 *   presentational: it reveals no data and makes no authorization decision.
 *   The gate stays in `admin/layout.tsx`, which runs `requireAdmin()` on the
 *   server, and every route and action re-checks it independently.
 */

export interface AdminNavItem {
  href: string;
  label: string;
}

/**
 * Longest-prefix match, so `/admin/users/123` still marks "Users" rather than
 * falling back to "Dashboard". Exact matching would light up nothing on any
 * detail page; naive `startsWith("/admin")` would light up two links at once.
 */
export function activeAdminHref(
  pathname: string | null,
  items: AdminNavItem[]
): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const item of items) {
    const matches =
      pathname === item.href ||
      (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
    if (!matches) continue;
    // `/admin` is the shortest href and therefore the weakest match; a longer
    // prefix that also matches is the more specific one. Selecting the longest
    // match — rather than the last one seen — is what makes this independent of
    // the order the sections are listed in.
    if (best === null || item.href.length > best.length) best = item.href;
  }
  return best;
}

export function AdminNav({
  items,
  onNavigate,
}: {
  items: AdminNavItem[];
  /** Called after a link is chosen, so the mobile drawer can close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = activeAdminHref(pathname, items);

  return (
    <ul className="space-y-1">
      {items.map(item => {
        const isActive = item.href === active;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              // `aria-current="page"` is what makes the current section
              // announceable; the background change is the visual counterpart.
              aria-current={isActive ? "page" : undefined}
              onClick={onNavigate}
              // `py-2.5`: 36px -> 40px per nav row. In the drawer these links are
              // the entire navigation on a phone, and the page is used one-handed.
              className={
                isActive
                  ? "block rounded-md bg-neutral-900 px-3 py-2.5 text-sm font-semibold text-white"
                  : "block rounded-md px-3 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              }
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}