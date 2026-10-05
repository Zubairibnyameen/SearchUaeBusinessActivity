import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin, type Viewer } from "@/lib/auth/viewer";
import { AuthRequiredError, ForbiddenError } from "@/lib/auth/errors";
import { LogoutButton } from "@/components/admin/logout-button";
import { AdminShell } from "@/components/admin/admin-shell";
import { UserCog } from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/profile", label: "My profile" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/jurisdictions", label: "Jurisdictions" },
  { href: "/admin/activities", label: "Activities" },
  { href: "/admin/import", label: "Data Import" },
  { href: "/admin/review", label: "Import Review" },
  { href: "/admin/sources", label: "Sources" },
  { href: "/admin/approvals", label: "Approvals" },
  { href: "/admin/fees", label: "Fees" },
  { href: "/admin/research", label: "Regulatory Research" },
  { href: "/admin/audit", label: "Audit Logs" },
];

/**
 * Admin output is per-session and per-request by definition: the guard below
 * reads the Supabase session cookie, and the dashboard reads live user rows.
 * Marking the tree dynamic stops the build from trying to prerender it — which
 * it can never do correctly, and which would otherwise run authorisation and
 * database counts at build time.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * Single authorization gate for the whole admin tree: a verified Supabase
   * session with role 'admin' and status 'active'.
   *
   *   no session            -> redirect to /signin (preserving where they were
   *                            going, so they land back on /admin)
   *   session, not an admin -> 404, NOT a redirect
   *
   * The 404 is deliberate. Redirecting a signed-in non-admin somewhere else
   * confirms that /admin exists and leaks the shape of the admin area; a 404
   * tells them nothing they did not already know. A suspended admin is treated
   * the same way — suspension is not a reason to advertise the admin area.
   *
   * Individual routes and server actions still call requireAdmin() themselves.
   * This layout is UX plus defence in depth, never the only check: it runs on
   * render, whereas a route handler or server action can be invoked directly.
   */
  let admin: Viewer;
  try {
    admin = await requireAdmin();
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      redirect("/signin?next=%2Fadmin");
    }
    if (error instanceof ForbiddenError) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/*
       * Skip link. The admin nav is twelve links before any content, so a
       * keyboard user had to traverse all of them on every page to reach the
       * page itself. Visually hidden until focused.
       */}
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-neutral-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>
      <AdminShell
        navItems={NAV_ITEMS}
        footer={
          <>
            <p className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
              <UserCog aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {/* `break-all`: an address is a single unbreakable token. `min-w-0`
                  lets the flex item shrink, but without a break opportunity the
                  glyphs spill through the panel border and past the 240px drawer
                  edge with nothing to scroll to. */}
              <span className="min-w-0 break-all">
                Signed in as{" "}
                <Link
                  href="/admin/profile"
                  className="font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
                >
                  {admin.email}
                </Link>
              </span>
            </p>
            <LogoutButton />
          </>
        }
      >
        {/* `tabIndex={-1}`: the skip link targets this div. Modern browsers move
            the sequential focus starting point to a non-focusable target, but
            making it programmatically focusable keeps the behaviour deterministic
            across engines and screen readers. */}
        <div id="admin-main" tabIndex={-1}>
          {children}
        </div>
      </AdminShell>
    </div>
  );
}
