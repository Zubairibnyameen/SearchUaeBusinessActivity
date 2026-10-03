"use server";

/**
 * Profile mutations.
 *
 * ONE validation path, THREE thin actions, used by `/account/profile`,
 * `/admin/profile` and the admin user detail page. The screens differ only in
 * which gate admits them and which row they are allowed to touch; the
 * validation and the single-column data access are shared, which is what makes
 * "the same server-side validation" a structural fact rather than a promise.
 */
import { revalidatePath } from "next/cache";
import { requireAdmin, requireViewer } from "@/lib/auth/viewer";
import { updateOwnProfile, updateUserProfileName } from "@/lib/auth/profile";
import { parseUserId } from "@/lib/auth/admin-users";
import { ForbiddenError } from "@/lib/auth/errors";
import { parseProfileUpdate } from "@/lib/auth/profile-schema";
import type { ProfileActionState } from "@/components/profile/profile-name-form";

/**
 * The only key a profile payload may carry, plus any structural key the calling
 * form legitimately needs.
 *
 * Everything else is dropped BEFORE validation, so a crafted form that includes
 * `role=admin` never reaches the schema. The schema's `.strict()` is the second
 * line of defence; this projection is the first. Neither is trusted alone.
 */
const EDITABLE_KEY = "fullName";

/**
 * Reduce a FormData to the editable field, rejecting any unexpected key.
 *
 * Returns a reason on rejection so the caller can surface a specific message
 * instead of a generic failure.
 */
function collectEditableFields(
  formData: FormData,
  allowedStructuralKeys: readonly string[] = []
):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: string } {
  for (const key of formData.keys()) {
    if (key === EDITABLE_KEY) continue;
    if (allowedStructuralKeys.includes(key)) continue;
    return { ok: false, reason: "Only your name can be changed here." };
  }

  const fullName = formData.get(EDITABLE_KEY);
  return { ok: true, data: { fullName: typeof fullName === "string" ? fullName : "" } };
}

function failure(message: string): ProfileActionState {
  return { ok: false, message, fullName: null };
}

function success(message: string, fullName: string | null): ProfileActionState {
  return { ok: true, message, fullName };
}

/** Update the signed-in user's own name. Used by `/account/profile`. */
export async function updateOwnProfileAction(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  let viewerId: string;
  try {
    // 401 anonymous, 403 suspended. Never a client-side check.
    viewerId = (await requireViewer()).id;
  } catch {
    return failure("Sign in to change your profile.");
  }

  const fields = collectEditableFields(formData);
  if (!fields.ok) return failure(fields.reason);

  const parsed = parseProfileUpdate(fields.data);
  if (!parsed.ok) return failure(parsed.error);

  try {
    const updated = await updateOwnProfile(viewerId, parsed.data);

    // The header, /account and both profile screens all read the same row.
    revalidatePath("/account");
    revalidatePath("/account/profile");
    revalidatePath("/admin/profile");

    return success(
      updated.fullName ? "Profile updated." : "Name removed.",
      updated.fullName
    );
  } catch (error) {
    if (error instanceof ForbiddenError) return failure(error.message);
    console.error("[profile] failed to update own profile:", error);
    return failure("Could not save your profile. Try again.");
  }
}

/** Update the signed-in administrator's own name. Used by `/admin/profile`. */
export async function updateAdminProfileAction(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  let adminId: string;
  try {
    // An administrator editing their OWN name still has to clear the admin gate.
    adminId = (await requireAdmin()).id;
  } catch {
    return failure("Administrator access is required.");
  }

  const fields = collectEditableFields(formData);
  if (!fields.ok) return failure(fields.reason);

  const parsed = parseProfileUpdate(fields.data);
  if (!parsed.ok) return failure(parsed.error);

  try {
    const updated = await updateUserProfileName({
      targetUserId: adminId,
      actingAdminId: adminId,
      input: parsed.data,
    });

    revalidatePath("/account/profile");
    revalidatePath("/admin/profile");
    revalidatePath(`/admin/users/${updated.id}`);

    return success(
      updated.fullName ? "Profile updated." : "Name removed.",
      updated.fullName
    );
  } catch (error) {
    if (error instanceof ForbiddenError) return failure(error.message);
    console.error("[admin] failed to update own profile:", error);
    return failure("Could not save your profile. Try again.");
  }
}

/** Update another account's name. Used by the admin user detail page. */
export async function updateUserProfileNameAction(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  let adminId: string;
  try {
    adminId = (await requireAdmin()).id;
  } catch {
    return failure("Administrator access is required.");
  }

  const fields = collectEditableFields(formData, ["userId"]);
  if (!fields.ok) return failure(fields.reason);

  const parsed = parseProfileUpdate(fields.data);
  if (!parsed.ok) return failure(parsed.error);

  /*
   * The target id arrives as a form field, so it is validated for shape. It
   * never influences the caller's own authorization — that was already decided
   * by requireAdmin() above — and a non-UUID or unknown id simply 404s at the
   * data layer, so this cannot be used to probe which ids exist.
   */
  const targetUserId = parseUserId(formData.get("userId"));
  if (!targetUserId) {
    return failure("That user id is not valid.");
  }

  try {
    const updated = await updateUserProfileName({
      targetUserId,
      actingAdminId: adminId,
      input: parsed.data,
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${updated.id}`);

    return success(`Updated ${updated.email}.`, updated.fullName);
  } catch (error) {
    if (error instanceof ForbiddenError) return failure(error.message);
    console.error("[admin] failed to update user profile name:", error);
    return failure("Could not update that user. Try again.");
  }
}
