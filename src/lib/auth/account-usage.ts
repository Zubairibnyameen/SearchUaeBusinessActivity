/**
 * Account usage and health — pure, no database access.
 *
 * WHY THIS IS PURE
 *   Everything here is derived from the caller's own `app_users` row, which the
 *   viewer DAL has already loaded and already authorized, plus an optional
 *   caller-supplied set of search counts that were read separately. No query, no
 *   second lookup, and — importantly — no way to compute a number for anyone
 *   other than the caller, because no id is accepted as an argument.
 *
 * SEARCH COUNTS ARE AN INPUT, NOT A QUERY
 *   `searches` is a discriminated union because "we do not know" and "the
 *   answer is zero" are different facts and must not collapse into each other:
 *
 *     available: false  -> the count query did not run or failed. The dashboard
 *                          must say usage is unavailable. It must NEVER render
 *                          this as `0`, because a zero would read as "you have
 *                          never searched", which is a different and false
 *                          statement about someone who has searched.
 *     available: true   -> these are real counts from `search_usage`, scoped to
 *                          the caller's own account. `total: 0` here is a
 *                          truthful "no searches recorded yet".
 *
 *   The dashboard supplies `searches` by calling
 *   `getSearchUsageCountsSafely(viewer)`, which returns `null` on failure and
 *   is mapped to the unavailable branch. The database is never touched here.
 */
import type { Viewer } from "./viewer";

export interface ProfileChecklistItem {
  key: "fullName" | "avatarUrl";
  label: string;
  /** What the person should do about it when it is incomplete. */
  hint: string;
  complete: boolean;
}

export interface AccountUsage {
  /**
   * Real search counts for this account, or the reason they are unavailable.
   *
   * `available: false` means "not known" and must be presented as such.
   * It deliberately never means "zero".
   */
  searches:
    | { available: false; reason: string }
    | { available: true; total: number; last30Days: number };

  /** Derived purely from fields the user controls; never a stored score. */
  profile: {
    /** 0-100, rounded, over the genuinely optional profile fields. */
    percentComplete: number;
    items: ProfileChecklistItem[];
  };

  account: {
    isActive: boolean;
    isAdmin: boolean;
    memberSince: Date;
    /** Whole days since sign-up, floored at 0. */
    memberForDays: number;
    lastLoginAt: Date | null;
    /** Human summary of the last sign-in, e.g. "today", "3 days ago". */
    lastLoginRelative: string | null;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: number): number {
  return Math.max(0, Math.floor((to - from.getTime()) / DAY_MS));
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * DAY_MS],
  ["month", 30 * DAY_MS],
  ["week", 7 * DAY_MS],
  ["day", DAY_MS],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

function relativeTime(value: Date, now: number): string {
  const delta = value.getTime() - now;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(delta) >= ms) {
      return formatter.format(Math.round(delta / ms), unit);
    }
  }
  return "just now";
}

/**
 * Entry point for callers that hold real counts but have no reason to control
 * the clock.
 *
 * Reading the current time here rather than in the calling component keeps
 * `Date.now()` out of a render body, where reading the wall clock is an impure
 * call. `now` stays injectable on `getAccountUsage` for the tests that need to
 * pin relative-time maths.
 */
export function getAccountUsageWithSearchCounts(
  viewer: Viewer,
  searches: { total: number; last30Days: number } | null
): AccountUsage {
  return getAccountUsage(viewer, Date.now(), searches);
}

/**
 * Build the usage view for the signed-in caller.
 *
 * `viewer` is the already-authorized identity — the caller never supplies an id,
 * so this function cannot be pointed at another account. `now` is injectable
 * purely so the relative-time and member-age maths is testable.
 *
 * `searches` is the caller's real counts, or `null` when they could not be read.
 * Passing `null` (the default) produces the unavailable branch rather than a
 * fabricated zero, so a missing argument can never be mistaken for data.
 */
export function getAccountUsage(
  viewer: Viewer,
  now: number = Date.now(),
  searches: { total: number; last30Days: number } | null = null
): AccountUsage {
  const items: ProfileChecklistItem[] = [
    {
      key: "fullName",
      label: "Display name",
      hint: "Add the name colleagues should see.",
      complete: Boolean(viewer.fullName?.trim()),
    },
    {
      key: "avatarUrl",
      label: "Profile picture",
      hint: "Google supplies this from your Google account picture.",
      complete: Boolean(viewer.avatarUrl),
    },
  ];

  const completeCount = items.filter(item => item.complete).length;

  return {
    searches: searches
      ? { available: true, total: searches.total, last30Days: searches.last30Days }
      : {
          available: false,
          reason:
            "Your search history could not be loaded just now, so no usage numbers are shown. Nothing has been estimated or filled in.",
        },
    profile: {
      percentComplete: Math.round((completeCount / items.length) * 100),
      items,
    },
    account: {
      isActive: viewer.isActive,
      isAdmin: viewer.isAdmin,
      memberSince: viewer.createdAt,
      memberForDays: daysBetween(viewer.createdAt, now),
      lastLoginAt: viewer.lastLoginAt,
      lastLoginRelative: viewer.lastLoginAt
        ? relativeTime(viewer.lastLoginAt, now)
        : null,
    },
  };
}
