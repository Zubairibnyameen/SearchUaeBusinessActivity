import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { countUsers, listUsers, requireAdmin } from "@/lib/auth/viewer";
import {
  UserAvatar,
  UserRoleBadge,
  UserStatusBadge,
} from "@/components/admin/user-badges";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Users",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 25;
const MAX_SEARCH = 200;

/**
 * Whitelists the query string. Anything unrecognised is dropped rather than
 * forwarded, so a crafted `?role=admin' OR 1=1--` simply filters nothing.
 */
function readParams(raw: {
  q?: string;
  role?: string;
  status?: string;
  page?: string;
}) {
  const search = (raw.q ?? "").trim().slice(0, MAX_SEARCH);
  const role = raw.role === "user" || raw.role === "admin" ? raw.role : undefined;
  const status =
    raw.status === "active" || raw.status === "suspended"
      ? raw.status
      : undefined;
  const parsed = Number.parseInt(raw.page ?? "1", 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return { search, role, status, page };
}

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-AE", {
    dateStyle: "medium",
    timeZone: "Asia/Dubai",
  }).format(value);
}

function formatDateTime(value: Date | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-AE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dubai",
  }).format(value);
}

function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email;
  return (
    source
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(p => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }>;
}) {
  // 401 unauthenticated / 403 authenticated-but-not-admin, both server-side.
  // The /admin layout has already bounced non-admins, so reaching this line
  // means the caller holds the admin role — but the check is repeated here so
  // the page is safe even if it is ever mounted outside that layout.
  const admin = await requireAdmin();

  const { search, role, status, page } = readParams(await searchParams);
  const offset = (page - 1) * PAGE_SIZE;

  const [users, total] = await Promise.all([
    listUsers({ search, role, status, limit: PAGE_SIZE, offset }),
    countUsers({ search, role, status }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(next: number): string {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    if (next > 1) params.set("page", String(next));
    const qs = params.toString();
    return qs ? `/admin/users?${qs}` : "/admin/users";
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {total} {total === 1 ? "account" : "accounts"}
            {search ? ` matching “${search}”` : ""}
            {role ? ` · role ${role}` : ""}
            {status ? ` · ${status}` : ""}
          </p>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <form
        method="get"
        action="/admin/users"
        className="mb-5 flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Filter users"
      >
        <div className="min-w-[14rem] flex-1">
          <label
            htmlFor="user-search"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500"
          >
            Search
          </label>
          <input
            id="user-search"
            type="search"
            name="q"
            defaultValue={search}
            maxLength={MAX_SEARCH}
            placeholder="Name or email"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
          />
        </div>

        <div>
          <label
            htmlFor="role-filter"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500"
          >
            Role
          </label>
          <select
            id="role-filter"
            name="role"
            defaultValue={role ?? ""}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
          >
            <option value="">All roles</option>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="status-filter"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500"
          >
            Status
          </label>
          <select
            id="status-filter"
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
        >
          Apply
        </button>
        {search || role || status ? (
          <Link
            href="/admin/users"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            Reset
          </Link>
        ) : null}
      </form>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">Application user accounts</caption>
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                <span className="sr-only">Avatar</span>
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">Name</th>
              <th scope="col" className="px-4 py-3 font-semibold">Email</th>
              <th scope="col" className="px-4 py-3 font-semibold">Provider</th>
              <th scope="col" className="px-4 py-3 font-semibold">Role</th>
              <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              <th scope="col" className="px-4 py-3 font-semibold">Created</th>
              <th scope="col" className="px-4 py-3 font-semibold">Last login</th>
              <th scope="col" className="px-4 py-3 font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {users.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-neutral-500">
                  No users match these filters.
                </td>
              </tr>
            ) : (
              users.map(user => {
                return (
                  <tr key={user.id} className="align-middle">
                    <td className="px-4 py-3">
                      <UserAvatar
                        src={user.avatarUrl}
                        name={user.fullName}
                        email={user.email}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="font-medium text-neutral-900 underline-offset-2 hover:underline"
                      >
                        {user.fullName?.trim() || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block max-w-[16rem] truncate text-neutral-700">
                        {user.email}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {user.provider === "google" ? "Google" : user.provider}
                    </td>
                    <td className="px-4 py-3">
                      <UserRoleBadge role={user.role} />
                    </td>
                    <td className="px-4 py-3">
                      <UserStatusBadge status={user.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                      {formatDateTime(user.lastLoginAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                      >
                        <ExternalLink aria-hidden className="size-3.5" />
                        Profile
                        {user.id === admin.id ? (
                          <span className="text-neutral-500">(you)</span>
                        ) : null}
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────── */}
      {total > 0 ? (
        <nav
          className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm"
          aria-label="Pagination"
        >
          <p className="text-neutral-500">
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </p>
          {/* `flex-wrap`: the outer nav wraps, but this inner row did not, so a
              4-digit page count would overflow a 320px screen. */}
          <div className="flex flex-wrap items-center gap-2">
            {page > 1 ? (
              <Link
                href={pageHref(page - 1)}
                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
              >
                Previous
              </Link>
            ) : null}
            <span className="text-neutral-500">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={pageHref(page + 1)}
                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}

      {/* Status controls live in the detail page; this row keeps the table
          free of nested forms while still giving one-click access. */}
      <div className="mt-8 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        <p>
          Open a user to review their full profile, correct their display name,
          or suspend and reactivate the account. Suspending blocks searching and
          gated features; it does not delete anything and public activity pages
          stay reachable. Roles are never editable here — promote an
          administrator through the <code>ADMIN_EMAILS</code> allowlist.
        </p>
      </div>
    </div>
  );
}
