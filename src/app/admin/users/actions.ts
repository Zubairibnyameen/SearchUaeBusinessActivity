"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/viewer";
import { ForbiddenError } from "@/lib/auth/errors";
import { setUserStatus, parseUserId } from "@/lib/auth/admin-users";

/**
 * Admin user-management server actions.
 *
 * `requireAdmin()` runs FIRST in every action, before the body is parsed, so an
 * unauthorized caller learns nothing about the request shape and never reaches
 * the database. The acting administrator is taken from the verified session —
 * never from a form field.
 */

const StatusInput = z.object({
  userId: z.string().min(1).max(64),
  status: z.enum(["active", "suspended"]),
  returnTo: z.string().max(2048).optional(),
});

export interface UserActionState {
  ok: boolean;
  message: string;
}

export async function updateUserStatus(
  _prev: UserActionState,
  formData: FormData
): Promise<UserActionState> {
  let adminId: string;
  try {
    adminId = (await requireAdmin()).id;
  } catch {
    return {
      ok: false,
      message: "Administrator access is required to manage users.",
    };
  }

  const parsed = StatusInput.safeParse({
    userId: formData.get("userId"),
    status: formData.get("status"),
    returnTo: typeof formData.get("returnTo") === "string"
      ? (formData.get("returnTo") as string)
      : undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: "That request was not valid." };
  }

  if (!parseUserId(parsed.data.userId)) {
    return { ok: false, message: "That user id is not valid." };
  }

  try {
    const updated = await setUserStatus({
      userId: parsed.data.userId,
      status: parsed.data.status,
      actingAdminId: adminId,
    });

    revalidatePath("/admin");
    revalidatePath("/admin/users");
    revalidatePath("/account");

    return {
      ok: true,
      message:
        updated.status === "suspended"
          ? `${updated.email} has been suspended.`
          : `${updated.email} has been reactivated.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: error.message };
    }
    console.error("[admin] failed to update user status:", error);
    return { ok: false, message: "Could not update that user. Try again." };
  }
}
