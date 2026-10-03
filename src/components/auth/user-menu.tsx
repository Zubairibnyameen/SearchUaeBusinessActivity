"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, Search as SearchIcon, Shield, User as UserIcon, UserCog } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Serializable subset of the viewer — no credentials ever cross to the client. */
export interface HeaderUser {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
}

function initialsOf(user: HeaderUser): string {
  const source = user.fullName?.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map(p => p[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

export function UserMenu({ user }: { user: HeaderUser }) {
  const [isPending, startTransition] = useTransition();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      // Server-side sign-out: the provider session is revoked and the
      // HttpOnly session cookies are cleared before we navigate away.
      await fetch("/auth/signout", { method: "POST" });
    } catch {
      // Even if the request fails, re-render from the server so the UI can
      // never show a stale signed-in state.
    } finally {
      setIsSigningOut(false);
      startTransition(() => {
        router.push("/");
        router.refresh();
      });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1.5 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 sm:pr-2.5"
            aria-label="Account menu"
          />
        }
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            width={26}
            height={26}
            className="h-[26px] w-[26px] rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white"
          >
            {initialsOf(user)}
          </span>
        )}
        <span className="hidden max-w-[9rem] truncate text-sm font-medium text-neutral-700 sm:inline">
          {user.fullName?.trim() || user.email}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-medium text-neutral-900">
            {user.fullName?.trim() || "Signed in"}
          </span>
          <span className="block truncate text-xs text-neutral-500">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.isAdmin ? (
          <>
            <DropdownMenuItem
              render={
                <Link href="/admin" className="flex items-center gap-2" />
              }
            >
              <Shield aria-hidden className="size-4" />
              Admin
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <Link href="/admin/profile" className="flex items-center gap-2" />
              }
            >
              <UserCog aria-hidden className="size-4" />
              Admin profile
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuItem
          render={<Link href="/account/profile" className="flex items-center gap-2" />}
        >
          <UserCog aria-hidden className="size-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<Link href="/account" className="flex items-center gap-2" />}
        >
          <UserIcon aria-hidden className="size-4" />
          Account
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<Link href="/search" className="flex items-center gap-2" />}
        >
          <SearchIcon aria-hidden className="size-4" />
          Search activities
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={handleSignOut}
          className="flex items-center gap-2"
        >
          <LogOut aria-hidden className="size-4" />
          {isSigningOut || isPending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SignInButton({
  nextPath,
  variant = "compact",
}: {
  nextPath: string;
  variant?: "compact" | "full";
}) {
  if (variant === "full") {
    return (
      <GoogleSignInButton nextPath={nextPath} size="md" label="Sign in" />
    );
  }
  return (
    <Link
      href={`/signin?next=${encodeURIComponent(nextPath)}`}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
    >
      Sign in
    </Link>
  );
}
