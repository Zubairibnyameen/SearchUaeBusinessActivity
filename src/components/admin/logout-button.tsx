"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="mt-6 block w-full px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 rounded-md"
    >
      Sign out
    </button>
  );
}
