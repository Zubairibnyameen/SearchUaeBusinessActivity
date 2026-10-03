/** Small presentational pieces shared by the admin user surfaces. */

export function UserStatusBadge({ status }: { status: "active" | "suspended" }) {
  const suspended = status === "suspended";
  return (
    <span
      className={
        suspended
          ? "inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
          : "inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
      }
    >
      {suspended ? "Suspended" : "Active"}
    </span>
  );
}

export function UserRoleBadge({ role }: { role: "user" | "admin" }) {
  const admin = role === "admin";
  return (
    <span
      className={
        admin
          ? "inline-flex items-center rounded-full border border-neutral-900 bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white"
          : "inline-flex items-center rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-xs font-medium text-neutral-700"
      }
    >
      {admin ? "Admin" : "User"}
    </span>
  );
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

export function UserAvatar({
  src,
  name,
  email,
  size = 28,
}: {
  src: string | null;
  name: string | null;
  email: string;
  size?: number;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-neutral-200 font-semibold text-neutral-600"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initialsOf(name, email)}
    </span>
  );
}
