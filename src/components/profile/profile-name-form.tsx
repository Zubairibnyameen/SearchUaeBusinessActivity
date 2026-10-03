"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, Check } from "lucide-react";
import { PROFILE_NAME_MAX } from "@/lib/auth/profile-schema";

/**
 * The result shape every profile action returns. Declared here — rather than in
 * each action file — so the form, the user action and the admin action cannot
 * drift apart in how they report success and failure.
 */
export interface ProfileActionState {
  ok: boolean;
  message: string;
  /** The name actually stored, echoed back so the form can reconcile. */
  fullName: string | null;
}

export const INITIAL_PROFILE_STATE: ProfileActionState = {
  ok: false,
  message: "",
  fullName: null,
};

function SubmitButton({ dirty, label }: { dirty: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending || !dirty}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * The form body. Split out so the outer component can remount it via `key` when
 * a save lands.
 *
 * Remounting is how this component reconciles with the server WITHOUT an
 * effect: the action returns the exact stored name (trimmed, and `null` rather
 * than `""` when cleared), the outer component uses it as a key, and React
 * throws away the old uncontrolled input and dirty flag for a fresh one. The
 * alternative — `setState` inside `useEffect` — cascades a second render on
 * every save and is the shape React's own lint rules reject.
 */
function FormBody({
  dispatch,
  initialFullName,
  hiddenFields,
  submitLabel,
  hint,
  fieldId,
  state,
}: {
  /** The `useActionState` dispatch, which takes only the FormData. */
  dispatch: (formData: FormData) => void;
  initialFullName: string;
  /** Structural form fields (e.g. the target `userId`) — never authorization. */
  hiddenFields?: Record<string, string>;
  submitLabel: string;
  hint: React.ReactNode;
  fieldId: string;
  state: ProfileActionState;
}) {
  const [dirty, setDirty] = useState(false);
  const hintId = `${fieldId}-hint`;

  return (
    <form action={dispatch} className="space-y-4">
      {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div>
        <label
          htmlFor={fieldId}
          className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500"
        >
          Full name
        </label>
        <Input
          id={fieldId}
          name="fullName"
          defaultValue={initialFullName}
          maxLength={PROFILE_NAME_MAX}
          autoComplete="name"
          onChange={event => setDirty(event.currentTarget.value !== initialFullName)}
          className="h-10 max-w-sm text-base"
          aria-describedby={hintId}
        />
        <p id={hintId} className="mt-1.5 text-xs text-neutral-500">
          {hint}
        </p>
      </div>

      <SubmitButton dirty={dirty} label={submitLabel} />

      {state.message ? (
        <p
          role="status"
          aria-live="polite"
          className={
            state.ok
              ? "flex items-center gap-1.5 text-sm text-emerald-700"
              : "flex items-center gap-1.5 text-sm text-red-600"
          }
        >
          {state.ok ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <AlertCircle aria-hidden className="size-4" />
          )}
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Editable profile fields.
 *
 * Intentionally renders an input for the name and NOTHING else. Role, status,
 * email, account id, creation time and last login are rendered as plain text on
 * the profile cards precisely so there is no control to re-enable from the
 * console or forge a request against — and the server action independently
 * rejects those fields, so hiding them here is defence in depth rather than the
 * only protection.
 *
 * Exactly one form field is named `fullName`; a crafted POST that adds `role` or
 * `status` is refused by the action's key allowlist and then its `.strict()`
 * schema, not merely ignored.
 */
export function ProfileNameForm({
  action,
  initialFullName,
  canSubmit = true,
  submitLabel = "Save changes",
  lockedReason,
  hint,
  hiddenFields,
  fieldId = "profile-full-name",
}: {
  action: (
    prev: ProfileActionState,
    formData: FormData
  ) => Promise<ProfileActionState>;
  initialFullName: string | null;
  /** False renders a read-only explanation instead of the form. */
  canSubmit?: boolean;
  submitLabel?: string;
  /** Explains why editing is unavailable, shown when `canSubmit` is false. */
  lockedReason?: string;
  /** Guidance under the field. */
  hint?: React.ReactNode;
  /** Structural form fields (e.g. the target `userId`) — never authorization. */
  hiddenFields?: Record<string, string>;
  /** Must be unique per form on a page, or labels will collide. */
  fieldId?: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL_PROFILE_STATE);

  if (!canSubmit) {
    return (
      <p
        role="status"
        className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        {lockedReason ?? "This account cannot be edited right now."}
      </p>
    );
  }

  /*
   * Until the first successful save the server has told us nothing new, so the
   * value the page rendered is authoritative. After a save, the action's echoed
   * `fullName` is. Using that as a key remounts the body on exactly that
   * transition — and not on a later keystroke — which resets the input to the
   * stored value and clears the dirty flag.
   */
  const confirmedName = state.ok ? (state.fullName ?? "") : null;
  const savedName = confirmedName ?? initialFullName ?? "";

  return (
    <FormBody
      key={savedName}
      dispatch={formAction}
      initialFullName={savedName}
      hiddenFields={hiddenFields}
      submitLabel={submitLabel}
      hint={
        hint ??
        "This is the only field you can change. Your role, status and email are managed for you."
      }
      fieldId={fieldId}
      state={state}
    />
  );
}
