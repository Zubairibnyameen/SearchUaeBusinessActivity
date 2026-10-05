"use client";

/**
 * Shared form primitives for the credential flows.
 *
 * Extracted so the sign-in, create-account, forgot-password and reset-password
 * forms cannot drift: one field definition, one error treatment, one pending
 * treatment, one set of focus/label/id wiring (which is where accessible forms
 * usually go wrong — an input with a label pointing at the wrong `id`).
 *
 * All state lives in the actions. These components hold no credential and make
 * no authorization decision.
 */
import { useId, type ChangeEvent, type ReactNode } from "react";
import { AlertCircle, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface AuthFieldProps {
  /** Visible label text. */
  label: string;
  name: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  /** Guidance rendered under the field; always linked via aria-describedby. */
  hint?: ReactNode;
  /** Per-field error. Takes precedence over `hint` for screen readers. */
  error?: string;
  disabled?: boolean;
  defaultValue?: string;
  autoFocus?: boolean;
  /** Presence switches the field to controlled; see the spread below. */
  value?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * One labelled field with its hint and error.
 *
 * `aria-invalid` is set on the input rather than only colouring it, so the
 * invalid state is announced, and the error is wired through
 * `aria-describedby` so it is read when focus lands on the field.
 */
export function AuthField({
  label,
  name,
  type = "text",
  autoComplete,
  placeholder,
  required = false,
  maxLength,
  minLength,
  hint,
  error,
  disabled = false,
  defaultValue,
  autoFocus = false,
  value: controlledValue,
  onChange,
}: AuthFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-neutral-700"
      >
        {label}
      </label>
      <Input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        minLength={minLength}
        disabled={disabled}
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        // Controlled inputs get `value`/`onChange`; uncontrolled ones get
        // `defaultValue`. Passing both would make the field read-only, and
        // passing neither would leave it uncontrolled and unusable when the
        // caller passes `value`.
        {...(controlledValue !== undefined
          ? { value: controlledValue, onChange }
          : { defaultValue })}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className="h-10"
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Full-width status banner.
 *
 * `role="status"` for success (polite, announced when it appears) and
 * `role="alert"` for failure (assertive), because an error the person is waiting
 * on should interrupt and a confirmation need not.
 */
export function AuthNotice({
  tone,
  children,
}: {
  tone: "success" | "error" | "info";
  children: ReactNode;
}) {
  const styles = {
    success:
      "border-emerald-300 bg-emerald-50 text-emerald-900",
    error: "border-red-200 bg-red-50 text-red-700",
    info: "border-amber-200 bg-amber-50 text-amber-900",
  }[tone];

  const Icon = tone === "success" ? Check : AlertCircle;

  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3.5 py-3 text-sm leading-relaxed",
        styles
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      {/* `min-w-0`: children can be caller-supplied (an email address, a URL),
          and a flex item is floored at min-content, so without it the notice
          would widen the page instead of wrapping. */}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * The primary submit button.
 *
 * Disabled while a request is in flight AND while the form is incomplete, so
 * the common mistake — pressing an empty or half-filled form — is prevented
 * rather than explained after a round trip.
 */
export function AuthSubmit({
  pending,
  disabled = false,
  children,
  pendingLabel,
  size = "lg",
  className,
}: {
  pending: boolean;
  disabled?: boolean;
  children: ReactNode;
  pendingLabel: string;
  size?: "lg" | "md";
  className?: string;
}) {
  const inactive = pending || disabled;

  return (
    <button
      type="submit"
      disabled={inactive}
      aria-busy={pending}
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:cursor-not-allowed disabled:opacity-60",
        size === "lg" ? "px-5 py-3 text-[15px]" : "px-4 py-2 text-sm",
        className
      )}
    >
      {pending ? (
        <>
          <span
            aria-hidden
            className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Horizontal rule with centred text, used to separate provider from email. */
export function AuthDivider({ children }: { children: ReactNode }) {
  return (
    <div className="relative my-5 flex items-center justify-center">
      <div aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-neutral-200" />
      <span className="relative bg-white px-3 text-xs uppercase tracking-wide text-neutral-500">
        {children}
      </span>
    </div>
  );
}

/** Consistent inline link styling inside auth copy. */
export function AuthLink({
  href,
  children,
  onClick,
}: {
  href: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25"
    >
      {children}
    </a>
  );
}