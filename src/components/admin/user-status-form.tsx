"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateUserStatus, type UserActionState } from "@/app/admin/users/actions";

const INITIAL: UserActionState = { ok: false, message: "" };

function Submit({
  status,
  isSelf,
}: {
  status: "active" | "suspended";
  isSelf: boolean;
}) {
  const { pending } = useFormStatus();
  const suspending = status === "active";

  if (isSelf) {
    return (
      <p className="text-sm text-neutral-500">
        You cannot change your own account status.
      </p>
    );
  }

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={
        suspending
          ? "rounded-md border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          : "rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      {pending
        ? suspending
          ? "Suspending…"
          : "Reactivating…"
        : suspending
          ? "Suspend user"
          : "Reactivate user"}
    </button>
  );
}

/**
 * Suspend / reactivate control.
 *
 * The `userId` and the target `status` are rendered as hidden inputs of a form
 * that posts to a server action which re-runs `requireAdmin()`. A hidden input
 * is a UI affordance only — the action validates the id shape, refuses to
 * change the acting admin's own status, and never writes the `role` column, so
 * nothing here can be used to escalate.
 */
export function UserStatusForm({
  userId,
  status,
  isSelf,
  returnTo,
}: {
  userId: string;
  status: "active" | "suspended";
  isSelf: boolean;
  returnTo: string;
}) {
  const [state, formAction] = useActionState(updateUserStatus, INITIAL);
  const nextStatus = status === "active" ? "suspended" : "active";

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="status" value={nextStatus} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Submit status={status} isSelf={isSelf} />
      {state.message ? (
        <p
          role="status"
          className={
            state.ok
              ? "text-sm text-emerald-700"
              : "text-sm text-red-600"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
