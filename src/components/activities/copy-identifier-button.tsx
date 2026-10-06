"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { writeClipboardText } from "@/lib/clipboard";
import {
  buildIdentifierCopyText,
  resolvePrimaryIdentifier,
} from "@/lib/activities/identifier";

/**
 * Jurisdiction-aware "Copy" for an activity's primary identifier.
 *
 *   AFZ        → copies `Activity Name: <name>` + `ISIC Code: <isic code>`
 *   Other      → copies `Activity Name: <name>` + `License Number: <license no>`
 *
 * The copy text is built from the authoritative jurisdiction slug, exactly like
 * the identifier display, so the two can never drift apart. A missing
 * identifier omits its line instead of copying an undefined/null/placeholder
 * value; if there is nothing to copy the control is not rendered.
 *
 * This is a separate control to the Share button — Share keeps carrying the
 * public URL, this carries the identifiers.
 */
export function CopyIdentifierButton({
  activityName,
  jurisdictionSlug,
  isicCode,
  activityCode,
  className,
}: {
  activityName: string;
  jurisdictionSlug: string;
  isicCode?: string | null;
  activityCode?: string | null;
  className?: string;
}) {
  const identifier = resolvePrimaryIdentifier({
    jurisdictionSlug,
    isicCode,
    activityCode,
  });
  const copyText = buildIdentifierCopyText(activityName, identifier);

  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);

  const copy = useCallback(async () => {
    if (!copyText) return;
    try {
      await writeClipboardText(copyText);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }, [copyText]);

  if (!copyText) return null;

  return (
    <>
      <button
        type="button"
        onClick={copy}
        title="Copy Activity Name and identifier"
        aria-label="Copy Activity Name and identifier"
        data-identifier-kind={identifier.kind}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
      >
        {status === "copied" ? (
          <Check aria-hidden className="size-3.5" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status === "copied"
          ? "Activity details copied to clipboard"
          : status === "error"
            ? "Could not copy activity details"
            : ""}
      </span>
    </>
  );
}