/**
 * Admin audit trail — server-only.
 *
 * Writes to the `admin_audit_logs` table, which backs /admin/audit. This is
 * NOT an authentication concern: it records what administrators did, and is
 * deliberately independent of who is allowed to do it.
 *
 * It used to live in the same module as the removed ADMIN_PASSWORD session
 * logic. With that gone, keeping it separate makes it obvious that the admin
 * area has exactly one authentication path (Supabase) and no second, parallel
 * one.
 */
import "server-only";

import { db } from "@/lib/db";
import { adminAuditLogs } from "@/lib/db/schema";

export async function logAdminEvent(input: {
  event: string;
  outcome?: "success" | "failure";
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(adminAuditLogs).values({
      event: input.event,
      outcome: input.outcome ?? "success",
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      details: input.details ?? null,
    });
  } catch (err) {
    // Audit failures must not crash admin flows, but must be visible.
    console.error("[audit] failed to record admin event:", err);
  }
}
