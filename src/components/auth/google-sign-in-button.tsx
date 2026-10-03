"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { buildOAuthCallbackUrl, currentBrowserOrigin } from "@/lib/auth/client-origin";
import { cn } from "@/lib/utils";

/** Google's official multi-colour "G" mark. */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden className={cn("h-4 w-4", className)}>
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.91c1.704-1.569 2.683-3.878 2.683-6.614z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.468-.806 5.957-2.181l-2.91-2.258c-.806.54-1.836.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.963 10.706A5.41 5.41 0 0 1 3.681 9c0-.593.102-1.17.282-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.322 0 2.508.454 3.442 1.345l2.582-2.582C13.463.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

export function GoogleSignInButton({
  /** Where to land after a successful sign-in. Must be a same-origin path. */
  nextPath,
  label = "Continue with Google",
  className,
  size = "lg",
  autoFocus = false,
}: {
  nextPath: string;
  label?: string;
  className?: string;
  size?: "lg" | "md";
  autoFocus?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (pending) return;
    setError(null);

    if (!isSupabaseConfigured()) {
      setError(
        "Google sign-in is not configured on this deployment. Please contact support."
      );
      return;
    }

    setPending(true);
    try {
      const supabase = createBrowserSupabaseClient();
      if (!supabase) {
        setError(
          "Google sign-in is not configured on this deployment. Please contact support."
        );
        setPending(false);
        return;
      }
      // The browser stores only the PKCE code verifier. The session tokens
      // themselves are exchanged server-side in /auth/callback and written to
      // HttpOnly cookies, so no token is ever readable from JavaScript.
      //
      // The origin is the browser's OWN `window.location.origin`, which is the
      // only source that cannot be spoofed: it is set from the address bar, not
      // from a `Host`/`X-Forwarded-Host` header. Local development therefore
      // stays on localhost and production stays on the deployed domain, with no
      // environment branch and nothing to keep in sync. `safeNextPath` already
      // validated `nextPath` on the server that rendered this component.
      const redirectTo = buildOAuthCallbackUrl(currentBrowserOrigin(), nextPath);

      if (!redirectTo) {
        // Fail closed rather than guess: without a provable origin the provider
        // could be handed an attacker-chosen return address.
        setError(
          "Google sign-in is unavailable in this browser context. Please contact support."
        );
        setPending(false);
        return;
      }

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, queryParams: { prompt: "select_account" } },
      });

      if (oauthError) {
        // The provider's own wording is not shown. It is logged server-side by
        // /auth/callback, and can name internal objects.
        console.error("[auth] google sign-in could not start:", oauthError.message);
        setError("Could not start Google sign-in. Please try again.");
        setPending(false);
      }
      // On success the browser is navigated to Google, so `pending` stays true.
    } catch {
      setError("Could not start Google sign-in. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        autoFocus={autoFocus}
        aria-busy={pending}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2.5 rounded-lg border border-neutral-300 bg-white font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:cursor-not-allowed disabled:opacity-60",
          size === "lg" ? "px-5 py-3 text-[15px]" : "px-4 py-2 text-sm"
        )}
      >
        <GoogleMark />
        {pending ? "Opening Google…" : label}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
