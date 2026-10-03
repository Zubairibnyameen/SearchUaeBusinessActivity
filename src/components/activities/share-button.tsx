"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Check, Link2, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Share controls for a public activity page.
 *
 * Three paths, in priority order:
 *   1. Native Web Share API  — the platform sheet (iOS/Android/desktop).
 *   2. WhatsApp deep link    — `https://wa.me/?text=…`, the primary channel in
 *      the UAE, so it is always offered even where Web Share exists.
 *   3. Copy link            — the universal fallback.
 *
 * The activity page itself is public, so the URL it shares is public too. No
 * authentication state, token or query string is attached to the shared link.
 */

export function buildShareUrl(path: string, origin?: string): string {
  if (origin) return `${origin.replace(/\/+$/, "")}${path}`;
  if (typeof window !== "undefined") return `${window.location.origin}${path}`;
  return path;
}

export function buildWhatsAppUrl(url: string, text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
}

/** The path copied/shared. Kept a pure function so it is trivially testable. */
export function sharePathForActivity(id: string): string {
  return `/activities/${id}`;
}

type Status = "idle" | "copied" | "shared" | "error";

/** No client state changes; this store exists only to branch on hydration. */
const subscribeNothing = () => () => {};

export function ShareButton({
  activityId,
  title,
  description,
  className,
  variant = "full",
}: {
  activityId: string;
  title: string;
  description?: string;
  className?: string;
  /**
   * `full` is the three-control set for a dedicated share area.
   *
   * `compact` is a single icon button for dense surfaces such as a search result
   * card, where a Share / WhatsApp / Copy row would outweigh the activity name
   * and the primary "View details" action. It keeps the same priority order -
   * native share where the browser has it, clipboard everywhere else - and the
   * same live region, so the outcome is still announced.
   */
  variant?: "full" | "compact";
}) {
  const [status, setStatus] = useState<Status>("idle");

  /*
   * The canonical URL and the Web Share feature check both need the browser,
   * but they must not be resolved in an effect: that would render one frame
   * with a dead "Copy link" button before filling it in. `useSyncExternalStore`
   * is the supported way to branch on "am I in the browser" during render —
   * the server snapshot is `false`, so the markup hydrates identically and then
   * upgrades on the client's first render.
   */
  const isClient = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  );

  const url = isClient
    ? buildShareUrl(sharePathForActivity(activityId))
    : "";
  const canNativeShare =
    isClient &&
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function";

  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);

  const shareText = description
    ? `${title} — ${description}`
    : title;

  const copyLink = useCallback(async () => {
    try {
      // The async Clipboard API is unavailable on insecure origins, so fall
      // back to a hidden textarea + execCommand.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const el = document.createElement("textarea");
        el.value = url;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }, [url]);

  const nativeShare = useCallback(async () => {
    try {
      await navigator.share({ title, text: shareText, url });
      setStatus("shared");
    } catch {
      // A user-cancelled share sheet rejects; that is not an error state.
      setStatus("idle");
    }
  }, [title, shareText, url]);

  const baseButton =
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 disabled:cursor-not-allowed disabled:opacity-60";

  /*
    Compact: exactly one control.

    Native share when available (the platform sheet is what a phone user
    expects), otherwise copy-to-clipboard. Neither WhatsApp nor a second button:
    this sits beside the primary "View details" action and must not compete with
    it. The status label is intentionally absent - the icon change plus the
    `role="status"` region below carry the feedback without shifting layout.
  */
  if (variant === "compact") {
    return (
      <>
        <button
          type="button"
          onClick={canNativeShare ? nativeShare : copyLink}
          disabled={!url}
          title={canNativeShare ? `Share ${title}` : `Copy link to ${title}`}
          aria-label={canNativeShare ? `Share ${title}` : `Copy link to ${title}`}
          className={cn(baseButton, "px-2.5 py-1.5")}
        >
          {status === "copied" || status === "shared" ? (
            <Check aria-hidden className="size-3.5" />
          ) : canNativeShare ? (
            <Share2 aria-hidden className="size-3.5" />
          ) : (
            <Link2 aria-hidden className="size-3.5" />
          )}
        </button>

        <span role="status" aria-live="polite" className="sr-only">
          {status === "copied"
            ? "Link copied to clipboard"
            : status === "shared"
              ? "Shared"
              : status === "error"
                ? "Could not copy the link"
                : ""}
        </span>
      </>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {canNativeShare ? (
        <button
          type="button"
          onClick={nativeShare}
          className={baseButton}
          aria-label={`Share ${title}`}
        >
          <Share2 aria-hidden className="size-3.5" />
          Share
        </button>
      ) : null}

      <a
        href={url ? buildWhatsAppUrl(url, shareText) : "#"}
        onClick={e => {
          if (!url) e.preventDefault();
        }}
        target="_blank"
        rel="noopener noreferrer"
        className={baseButton}
        aria-label={`Share ${title} on WhatsApp`}
      >
        {/* WhatsApp glyph */}
        <svg aria-hidden viewBox="0 0 24 24" className="size-3.5 fill-current">
          <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.48-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.47s1.06 2.86 1.21 3.06c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z" />
          <path d="M12.04 2C6.6 2 2.17 6.43 2.17 11.87c0 1.74.46 3.44 1.32 4.94L2 22l5.34-1.4a9.83 9.83 0 0 0 4.7 1.2h.01c5.43 0 9.86-4.43 9.86-9.87A9.8 9.8 0 0 0 19.6 4.4 9.8 9.8 0 0 0 12.04 2zm0 17.98h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.15 8.15 0 0 1-1.25-4.35c0-4.52 3.68-8.2 8.21-8.2a8.15 8.15 0 0 1 5.79 2.41 8.14 8.14 0 0 1 2.4 5.8c0 4.52-3.67 8.2-8.18 8.2z" />
        </svg>
        WhatsApp
      </a>

      <button
        type="button"
        onClick={copyLink}
        disabled={!url}
        className={baseButton}
        aria-label={`Copy link to ${title}`}
      >
        {status === "copied" ? (
          <Check aria-hidden className="size-3.5" />
        ) : (
          <Link2 aria-hidden className="size-3.5" />
        )}
        {status === "copied" ? "Copied" : "Copy link"}
      </button>

      {/*
        Announced to assistive tech only. The visible labels above already
        change, but a live region makes the outcome unambiguous.
      */}
      <span role="status" aria-live="polite" className="sr-only">
        {status === "copied"
          ? "Link copied to clipboard"
          : status === "shared"
            ? "Shared"
            : status === "error"
              ? "Could not copy the link"
              : ""}
      </span>
    </div>
  );
}
