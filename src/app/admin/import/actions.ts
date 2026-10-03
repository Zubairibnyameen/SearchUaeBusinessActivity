"use server";

/**
 * /admin/import server action.
 *
 * Order of operations is deliberate:
 *   1. `requireAdmin()` — before the body is even read, so an unauthorized
 *      caller learns nothing about the request shape and never touches the DB.
 *   2. Zod-validate the scalar fields.
 *   3. Validate the uploaded file itself (size, name, extension, magic bytes).
 *   4. Run the existing ingestion pipeline.
 *   5. Audit the outcome.
 *
 * The acting admin comes from the verified session only. There is no form field
 * that can name the caller, and nothing here can change a role or a status.
 */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/viewer";
import { logAdminEvent } from "@/lib/auth/audit";
import {
  ImportRequestError,
  runAdminImport,
  type ImportSummary,
} from "@/lib/admin/import-service";
import { IMPORTABLE_SOURCES } from "@/lib/ingestion/registry";

const ImportInput = z.object({
  slug: z.string().min(1).max(50),
  dryRun: z.boolean(),
});

export interface ImportActionState {
  ok: boolean;
  message: string;
  /** Present on success so the page can show the full counters. */
  summary?: ImportSummary;
  fieldErrors?: Record<string, string>;
}

const INITIAL: ImportActionState = { ok: false, message: "" };

export async function runImportAction(
  _prev: ImportActionState,
  formData: FormData
): Promise<ImportActionState> {
  let adminId: string;
  try {
    adminId = (await requireAdmin()).id;
  } catch {
    return { ok: false, message: "Administrator access is required to import data." };
  }

  const rawSlug = formData.get("slug");
  const parsed = ImportInput.safeParse({
    slug: typeof rawSlug === "string" ? rawSlug : "",
    dryRun: formData.get("dryRun") === "on" || formData.get("dryRun") === "true",
  });
  if (!parsed.success) {
    return { ok: false, message: "Choose a source before importing.", fieldErrors: { slug: "Required" } };
  }

  // A slug that is not in the registry is rejected here rather than being
  // passed to the importer, so an unapproved jurisdiction can never be reached.
  if (!IMPORTABLE_SOURCES.some(s => s.slug === parsed.data.slug)) {
    return {
      ok: false,
      message: "That source is not supported.",
      fieldErrors: { slug: "Unsupported source" },
    };
  }

  const entry = formData.get("file");
  const file =
    entry instanceof File && entry.size > 0
      ? { filename: entry.name, bytes: Buffer.from(await entry.arrayBuffer()) }
      : null;

  try {
    const summary = await runAdminImport({
      slug: parsed.data.slug,
      file,
      dryRun: parsed.data.dryRun,
    });

    const h = await headers();
    await logAdminEvent({
      event: summary.dryRun ? "import.dry_run" : "import.run",
      outcome: summary.errors.length > 0 ? "failure" : "success",
      ip: h.get("x-forwarded-for"),
      userAgent: h.get("user-agent"),
      details: {
        adminId,
        source: summary.slug,
        dryRun: summary.dryRun,
        rowsDiscovered: summary.rowsDiscovered,
        rowsAccepted: summary.rowsAccepted,
        rowsRejected: summary.rowsRejected,
        reviewItemsCreated: summary.reviewItemsCreated,
        // Hash only: enough to trace the artifact, not a copy of the payload.
        artifactSha256: summary.artifact?.sha256 ?? null,
      },
    });

    revalidatePath("/admin");
    revalidatePath("/admin/review");

    return {
      ok: true,
      message: summary.dryRun
        ? `Dry run complete — ${summary.rowsAccepted} row(s) would be imported. Nothing was written.`
        : `Imported ${summary.rowsAccepted} of ${summary.rowsDiscovered} row(s) from ${summary.sourceLabel}.`,
      summary,
    };
  } catch (error) {
    if (error instanceof ImportRequestError) {
      await logAdminEvent({
        event: "import.rejected",
        outcome: "failure",
        details: { adminId, source: parsed.data.slug, field: error.field },
      });
      return { ok: false, message: error.message, fieldErrors: { [error.field]: error.message } };
    }
    console.error("[admin] import failed:", error);
    return { ok: false, message: "The import could not be completed. Try again." };
  }
}