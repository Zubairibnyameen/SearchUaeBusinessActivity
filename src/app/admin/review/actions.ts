"use server";

/**
 * /admin/review server actions.
 *
 * Every action re-runs `requireAdmin()` first: a server action is reachable by
 * direct POST, so the page's gate proves nothing about the request itself.
 *
 * The reviewer is taken from the verified session and written to the audit
 * trail — never from a form field. There is no action here that changes a role,
 * a user status, an approval, a fee or an activity's regulatory status.
 */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/viewer";
import { logAdminEvent } from "@/lib/auth/audit";
import {
  REVIEW_DECISIONS,
  ReviewActionError,
  resolveReviewItem,
} from "@/lib/admin/review-queue";

const ReviewInput = z.object({
  id: z.string().uuid("That review item id is not valid."),
  decision: z.enum(REVIEW_DECISIONS, { message: "Unknown review action." }),
  note: z.string().max(2000).optional(),
});

export interface ReviewActionState {
  ok: boolean;
  message: string;
}

export async function resolveReviewAction(
  _prev: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  let adminId: string;
  try {
    adminId = (await requireAdmin()).id;
  } catch {
    return { ok: false, message: "Administrator access is required to review items." };
  }

  const rawNote = formData.get("note");
  const parsed = ReviewInput.safeParse({
    id: formData.get("id"),
    decision: formData.get("decision"),
    note: typeof rawNote === "string" ? rawNote : undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "That request was not valid.",
    };
  }

  const { id, decision } = parsed.data;
  const note = parsed.data.note?.trim();

  try {
    const result = await resolveReviewItem({ id, decision, note });

    const h = await headers();
    await logAdminEvent({
      event: `review.${decision === "pending" ? "kept_pending" : `${decision}d`}`,
      outcome: "success",
      ip: h.get("x-forwarded-for"),
      userAgent: h.get("user-agent"),
      // adminId is the verified session identity. No free-text personal data and
      // no secrets: the note is length-bounded and lives on the queue row.
      details: { adminId, reviewItemId: id, decision, status: result.status },
    });

    revalidatePath("/admin/review");
    revalidatePath(`/admin/review/${id}`);
    revalidatePath("/admin");

    return {
      ok: true,
      message:
        decision === "approve"
          ? "Accepted. The reviewer accepted this source row; no regulatory claim was created."
          : decision === "reject"
            ? "Rejected. This source row stays out of the dataset."
            : "Left pending for another reviewer.",
    };
  } catch (error) {
    if (error instanceof ReviewActionError) {
      await logAdminEvent({
        event: "review.action_rejected",
        outcome: "failure",
        details: { adminId, reviewItemId: id, decision, reason: error.code },
      });
      return { ok: false, message: error.message };
    }
    console.error("[admin] review action failed:", error);
    return { ok: false, message: "That action could not be completed. Try again." };
  }
}