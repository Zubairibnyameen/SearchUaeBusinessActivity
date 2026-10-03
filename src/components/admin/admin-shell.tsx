"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AdminNav, type AdminNavItem } from "@/components/admin/admin-nav";

/**
 * The admin chrome: a persistent sidebar on wide screens, a drawer on narrow
 * ones.
 *
 * WHY THE LAYOUT CHANGED
 *   The sidebar was a fixed `w-64` (256px) in an unconditional flex row, with
 *   `p-8` (32px per side) on the content column. At a 375px phone that leaves
 *   375 − 256 − 64 = **55px** of usable content width, so every admin page was
 *   unusable on a phone: the nav consumed the screen and the page itself was a
 *   sliver. At 320px it was worse than that.
 *
 *   Below `md` the nav is now a drawer behind a menu button, which is the
 *   standard answer and uses the `Sheet` primitive already in the project. The
 *   desktop sidebar is unchanged above `md`, so nothing moves for existing users.
 *
 * SERVER AUTHORIZATION IS UNAFFECTED
 *   This component renders navigation and nothing else. It receives no viewer, no
 *   row data and no capability flags, and makes no decision about who may see
 *   what — `admin/layout.tsx` has already run `requireAdmin()` on the server
 *   before this renders, and every route and server action re-checks it. A
 *   client component cannot widen access to anything, because the data behind
 *   these links is only ever fetched by server code that re-authorizes.
 */

function SidebarBody({
  navItems,
  footer,
  onNavigate,
}: {
  navItems: AdminNavItem[];
  footer: React.ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Admin sections" className="min-h-0 flex-1 overflow-y-auto">
        <AdminNav items={navItems} onNavigate={onNavigate} />
      </nav>
      <div className="mt-6 shrink-0 space-y-3">{footer}</div>
    </div>
  );
}

export function AdminShell({
  navItems,
  footer,
  children,
}: {
  navItems: AdminNavItem[];
  /** Server-rendered identity panel and sign-out, passed in as a prop. */
  footer: React.ReactNode;
  /**
   * Optional so callers can pass it the way `react/no-children-prop` requires
   * (`createElement(Shell, props, child)`) without a cast. Next.js always
   * supplies it; nothing renders a childless admin shell in practice.
   */
  children?: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen">
      {/* ── Narrow screens: a sticky bar with the nav behind a drawer ────── */}
      <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger
            render={
              <button
                type="button"
                className="-ml-1 inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
              />
            }
          >
            <Menu aria-hidden className="size-5" />
            Menu
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="border-b border-neutral-200 p-4">
              <SheetTitle className="text-sm font-semibold text-neutral-900">
                Admin menu
              </SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <SidebarBody
                navItems={navItems}
                footer={footer}
                // Close on navigate, otherwise the drawer stays open on top of
                // the page the admin just asked for.
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
        <span className="truncate text-sm font-semibold text-neutral-900">
          Admin
        </span>
      </div>

      {/* ── Wide screens: the original persistent sidebar ────────────────── */}
      <div className="md:flex">
        {/*
         * Sticky and independently scrollable. With twelve sections plus the
         * identity panel and sign-out, the nav is taller than a laptop viewport;
         * scrolling the page to reach "Sign out" meant scrolling the whole admin
         * shell, and on a short window the sign-out control could sit below the
         * fold with no way to reveal it.
         */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-white p-4 md:flex">
          <div className="mb-6">
            <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-700">
              &larr; Back to App
            </Link>
          </div>
          {/*
           * A <p>, not an <h2>. This text was the first heading in the tree while
           * every admin page renders its own <h1> inside <main>, so screen-reader
           * heading navigation announced "Admin Panel" before the page title on
           * every screen. It is a branding label, not a section heading; the
           * section list is labelled by the <nav aria-label> instead.
           */}
          <p className="mb-6 text-lg font-bold text-neutral-900">Admin Panel</p>
          <SidebarBody navItems={navItems} footer={footer} />
        </aside>
        <main className="min-w-0 flex-1 overflow-x-auto p-4 sm:p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}