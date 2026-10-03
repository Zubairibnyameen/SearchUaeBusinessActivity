/**
 * Profile field rules — shared by the user and admin profile screens.
 *
 * This module is deliberately NOT server-only: it holds no data access and no
 * credentials, only the single source of truth for *which* profile fields a
 * person is allowed to change and how they are validated. Both the server
 * actions and the client form components import it so the input `maxLength`
 * can never drift from the server-side validator.
 *
 * WHAT IS NOT HERE, AND WHY
 *   role, status, email, authUserId, providerUserId, createdAt, lastLoginAt
 *
 * Those are the columns that decide who can see what. Making them writable
 * through a profile form — even behind a "the UI hides the control" argument —
 * would mean one bug in one component is a privilege-escalation bug. They are
 * absent from the schema entirely rather than merely omitted from the UI, so a
 * malicious payload naming them is rejected by validation instead of being
 * silently dropped or, worse, written.
 */
import { z } from "zod";

/** Mirrors `app_users.full_name` (varchar 255). */
export const PROFILE_NAME_MAX = 255;

/**
 * The complete set of fields a person may edit on their own profile.
 *
 * Kept as a literal object so `.strict()` below can reject anything else. In
 * Zod, the default is to *strip* unknown keys, which would quietly discard a
 * `role: "admin"` in a crafted payload and then write it anyway if any future
 * code path spread the raw object into an update. `.strict()` turns that class
 * of bug into a loud 400.
 */
export const profileUpdateSchema = z
  .object({
    /**
     * An empty (or whitespace-only) value is a legitimate "clear my name" and is
     * stored as NULL, because `app_users.full_name` is nullable and Google
     * frequently supplies no name at all. Trimming happens here so the stored
     * value can never contain leading or trailing whitespace from a paste.
     */
    fullName: z
      .string()
      .trim()
      .max(PROFILE_NAME_MAX, `Name must be ${PROFILE_NAME_MAX} characters or fewer.`),
  })
  .strict();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/** Normalise a validated name to exactly what goes in the column. */
export function toStoredFullName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Human-readable list of what the profile form can change, used to render the
 * "you can edit these" affordance so the UI never implies more control than the
 * server actually grants.
 */
export const EDITABLE_PROFILE_FIELDS = ["fullName"] as const;

/** Parse raw FormData (or a JSON body) into validated, safe profile input. */
export function parseProfileUpdate(
  raw: Record<string, unknown>
):
  | { ok: true; data: ProfileUpdateInput }
  | { ok: false; error: string } {
  const parsed = profileUpdateSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };

  const first = parsed.error.issues[0];
  if (first) {
    // Path is [] for a top-level .strict() rejection, which is exactly the
    // "you tried to send a field you may not change" case.
    if (first.code === "unrecognized_keys") {
      return {
        ok: false,
        error: "Only your name can be changed here.",
      };
    }
    return { ok: false, error: first.message };
  }
  return { ok: false, error: "That request was not valid." };
}
