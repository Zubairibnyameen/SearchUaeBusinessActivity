"use client";

/**
 * Review decision controls.
 *
 * Reject is destructive — it closes the item and is not reversible from the UI —
 * so it is gated behind an explicit confirmation, and it requires a written
 * reason (enforced again server-side).
 *
 * The item id and decision are hidden inputs. They are a UI affordance only: the
 * action re-validates the id shape and re-runs `requireAdmin()`, and it takes the
 * reviewer from the session rather than from anything posted here.
 */

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { resolveReviewAction, type ReviewActionState } from "@/app/admin/review/actions";

const INITIAL: ReviewActionState = { ok: false, message: "" };

function ActionButton({
  decision,
  label,
  pendingLabel,
  confirm,
  className,
}: {
  decision: "approve" | "reject" | "pending";
  label: string;
  pendingLabel: string;
  confirm?: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="decision"
      value={decision}
      disabled={pending}
      aria-busy={pending}
      data-confirm={confirm}
      onClick={
        confirm
          ? e => {
              // The server enforces the outcome either way; this only avoids a
              // mis-click on an irreversible action.
              if (!window.confirm(confirm)) e.preventDefault();
            }
          : undefined
      }
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function ReviewDecisionForm({ itemId }: { itemId: string }) {
  const [state, formAction] = useActionState(resolveReviewAction, INITIAL);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={itemId} />

      <div>
        <label htmlFor="note" className="mb-1 block text-sm font-medium text-neutral-700">
          Reviewer note
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          maxLength={2000}
          placeholder="What did you check, and what did you conclude? Required to reject."
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          decision="approve"
          label="Accept"
          pendingLabel="Accepting…"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
        />
        <ActionButton
          decision="pending"
          label="Leave pending"
          pendingLabel="Saving…"
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
        />
        <ActionButton
          decision="reject"
          label="Reject"
          pendingLabel="Rejecting…"
          confirm="Reject this source row? The item leaves the queue and cannot be re-opened from here."
          className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 transition-colors hover:bg-red-100"
        />
      </div>

      {state.message ? (
        <p
          role="status"
          className={state.ok ? "text-sm text-emerald-700" : "text-sm text-red-600"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}