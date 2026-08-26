import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth";
import { LogoutButton } from "@/components/admin/logout-button";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Every /admin page is guarded here — unauthenticated visitors are bounced
  // to the login screen before any admin content renders.
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 bg-white border-r border-neutral-200 p-4">
        <div className="mb-6">
          <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-700">
            &larr; Back to App
          </Link>
        </div>
        <h2 className="text-lg font-bold mb-6">Admin Panel</h2>
        <nav className="space-y-1">
          <Link
            href="/admin"
            className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-neutral-100"
          >
            Dashboard
          </Link>
          <Link
            href="/admin/jurisdictions"
            className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-neutral-100"
          >
            Jurisdictions
          </Link>
          <Link
            href="/admin/activities"
            className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-neutral-100"
          >
            Activities
          </Link>
          <Link
            href="/admin/import"
            className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-neutral-100"
          >
            Data Import
          </Link>
          <Link
            href="/admin/sources"
            className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-neutral-100"
          >
            Sources
          </Link>
          <Link
            href="/admin/approvals"
            className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-neutral-100"
          >
            Approvals
          </Link>
          <Link
            href="/admin/fees"
            className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-neutral-100"
          >
            Fees
          </Link>
          <Link
            href="/admin/research"
            className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-neutral-100"
          >
            Regulatory Research
          </Link>
          <Link
            href="/admin/audit"
            className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-neutral-100"
          >
            Audit Logs
          </Link>
        </nav>
        <LogoutButton />
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
