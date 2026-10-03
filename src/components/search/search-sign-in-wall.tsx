import Link from "next/link";
import { AuthDivider } from "@/components/auth/auth-form-parts";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { safeNextPath } from "@/lib/auth/redirects";

const PERKS = [
  {
    title: "Every jurisdiction, one search",
    body: "DMCC, RAKEZ, IFZA, SPC Free Zone and Ajman Free Zone side by side, with mainland authorities as they are indexed.",
  },
  {
    title: "Verified fees and approvals",
    body: "Government fees and approvals are shown only where confirmed against an official source — never estimated or assumed.",
  },
  {
    title: "Jurisdiction comparison",
    body: "Put up to four authorities side by side for the same activity in one view.",
  },
];

/** Plain envelope mark, mirroring `GoogleMark` so both options read as peers. */
function EmailMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
      />
    </svg>
  );
}

/**
 * Server-rendered sign-in wall for the gated search and comparison surfaces.
 *
 * Rendered instead of results when there is no valid session, so an
 * unauthenticated request never reaches the search engine at all. The pending
 * query is preserved in `nextPath` and survives the round trip.
 *
 * Both authentication methods the product actually supports are offered here —
 * Google and email/password — matching `/signin`. The email option is a link
 * into that existing page rather than a second copy of the sign-in form, so
 * there is no duplicated `signInWithEmail` call and no divergent validation.
 *
 * `safeNextPath()` is applied here rather than trusted from the caller, because
 * this value is what gets handed to the OAuth provider and to `/signin?next=`.
 */
export function SearchSignInWall({
  nextPath,
  query,
  title = "Create a free account to search",
}: {
  nextPath: string;
  query?: string | null;
  title?: string;
}) {
  const next = safeNextPath(nextPath);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-7 sm:p-10">
      <div className="mx-auto max-w-lg text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="h-5 w-5 text-neutral-500"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
        </div>

        <h2 className="mt-4 font-heading text-xl font-semibold tracking-tight text-neutral-900">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          {query ? (
            <>
              You searched for{" "}
              <span className="font-semibold text-neutral-900">
                &ldquo;{query}&rdquo;
              </span>
              . Sign in and you&rsquo;ll land straight back on these results.
            </>
          ) : (
            <>
              Search is free with an account — no card, no trial, no expiry.
            </>
          )}
        </p>

        <GoogleSignInButton nextPath={next} className="mt-6" />

        <AuthDivider>or</AuthDivider>

        <Link
          href={`/signin?next=${encodeURIComponent(next)}`}
          className="inline-flex w-full items-center justify-center gap-2.5 rounded-lg border border-neutral-300 bg-white px-5 py-3 text-[15px] font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25"
        >
          <EmailMark className="h-4 w-4" />
          Continue with Email
        </Link>

        <p className="mt-4 text-xs text-neutral-500">
          Use Google or your email address — either way we only ask for what we
          need to confirm who you are.
        </p>
      </div>

      <dl className="mt-9 grid gap-6 border-t border-neutral-200 pt-7 sm:grid-cols-3">
        {PERKS.map(perk => (
          <div key={perk.title}>
            <dt className="text-sm font-semibold text-neutral-900">
              {perk.title}
            </dt>
            <dd className="mt-1 text-xs leading-relaxed text-neutral-500">
              {perk.body}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
