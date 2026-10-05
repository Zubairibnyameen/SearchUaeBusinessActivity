import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/**
 * Shown to a signed-in but suspended account.
 *
 * A suspended viewer still has a valid provider session, so every screen can
 * render their identity — they simply cannot use the gated product features,
 * which `requireViewer()` rejects with 403 server-side. Telling them so
 * explicitly is better than looping them back into a sign-in prompt they can
 * never satisfy.
 *
 * Deliberately contains no sign-in button: re-authenticating would not lift a
 * suspension, and offering it would just be a dead end.
 */
export function AccountSuspendedNotice({
  variant = "panel",
}: {
  /** `panel` for a results/landing slot, `inline` for a strip under a header. */
  variant?: "panel" | "inline";
}) {
  if (variant === "inline") {
    return (
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"
      >
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {/* `min-w-0`: the surrounding flex row would otherwise floor this
            paragraph at min-content and widen the strip. */}
        <p className="min-w-0 leading-relaxed">
          <span className="font-semibold">Your account is suspended.</span>{" "}
          Searching is unavailable. Public activity pages still work.{" "}
          <Link href="/account" className="underline underline-offset-2">
            View account
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-white p-7 sm:p-10">
      <div className="mx-auto max-w-lg text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-50">
          <ShieldAlert aria-hidden className="h-5 w-5 text-amber-600" />
        </div>

        <h2 className="mt-4 font-heading text-xl font-semibold tracking-tight text-neutral-900">
          Your account is suspended
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Searching is unavailable while your account is suspended. Public
          activity pages remain open — if someone has shared a specific activity
          with you, you can still open it.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/account"
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
          >
            View account
          </Link>
          <Link
            href="/activities"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
          >
            Browse public activities
          </Link>
        </div>
      </div>
    </div>
  );
}
