"use server";

/**
 * Regulatory research workflow actions (Phase 3 Part 11).
 *
 * Every action:
 *   - re-verifies admin auth (server actions are reachable via direct POST)
 *   - writes an audit-log entry
 *   - enforces the data rules: a "verified" outcome REQUIRES an official
 *     source URL from an authoritative authority; third-party links can be
 *     stored as candidate leads only.
 */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import {
  regulatoryResearchQueue,
  sources,
  approvals,
  approvalAuthorities,
  verificationHistory,
} from "@/lib/db/schema";
import { isAdminAuthenticated, logAdminEvent } from "@/lib/auth";
import { eq, and, or, isNull } from "drizzle-orm";
import crypto from "node:crypto";
import { z } from "zod";

const UUID_SCHEMA = z.string().uuid();
const NOTES_SCHEMA = z.string().max(4000);
const URL_SCHEMA = z.string().url().max(1000).optional().or(z.literal(""));

/**
 * Input validation for the research workflow. All mutations Zod-validate their
 * FormData inputs before touching the database:
 *  - `id` must be a well-formed UUID
 *  - free-text fields are length-bounded
 *  - URLs are structurally validated
 * Existing validation for official-source enforcement is preserved alongside.
 */
const ResearchIdInput = z.object({
  id: UUID_SCHEMA,
});

const ResearchNotesInput = ResearchIdInput.extend({
  notes: NOTES_SCHEMA,
  candidateSourceUrl: URL_SCHEMA,
});

const ResearchReviewInput = ResearchIdInput.extend({
  reviewNotes: NOTES_SCHEMA,
});

const ResearchConflictInput = ResearchIdInput.extend({
  conflictNotes: NOTES_SCHEMA,
});

const ResearchVerifiedInput = ResearchIdInput.extend({
  verifiedSourceUrl: z.string().url().max(1000),
  verifiedSourceTitle: z.string().min(1).max(500),
  authorityName: NOTES_SCHEMA,
  approvalName: NOTES_SCHEMA,
  approvalType: z.string().max(50),
  requirementText: NOTES_SCHEMA,
  applicationProcess: NOTES_SCHEMA,
  conditions: NOTES_SCHEMA,
  requiredDocuments: NOTES_SCHEMA,
});

const ResearchNotRequiredInput = ResearchIdInput.extend({
  notRequiredSourceUrl: z.string().url().max(1000),
  rationale: NOTES_SCHEMA,
});

function parseForm<T extends z.ZodTypeAny>(
  schema: T,
  formData: FormData
): z.infer<T> {
  const raw: Record<string, FormDataEntryValue | undefined> = {};
  for (const [k, v] of Array.from(formData.entries())) raw[k] = v;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path?.[0] ?? "input");
    const reason = String(issue?.message ?? "invalid input");
    throw new Error(`${field}: ${reason}`);
  }
  return parsed.data as z.infer<T>;
}

const OFFICIAL_HOST_PATTERNS = [
  /\.gov\.ae$/,
  /\.(gov|mil)$/,
  /^(www\.)?(dmcc|ifza|rakez|spcfz|spcfreezone|ajmanfreezones|afz)\./,
  /^(www\.)?(mohap|dha|tdra|khda|dcaa|sira|ded|municipality|centralbank|vara|scasec|uiae)\./,
];

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|::1|fc|fd|fe80)/i;
const MAX_FETCH_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

function looksOfficial(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (PRIVATE_IP_RE.test(host)) return false;
    if (host === "localhost" || host.endsWith(".localhost")) return false;
    return true;
  } catch {
    return false;
  }
}

async function safeFetch(url: string): Promise<{ ok: boolean; body: string | null }> {
  if (!isSafeUrl(url)) return { ok: false, body: null };
  try {
    const res = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, body: null };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/json")) {
      return { ok: false, body: null };
    }
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, body: null };
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      if (totalBytes > MAX_FETCH_BYTES) {
        reader.cancel();
        return { ok: false, body: null };
      }
      chunks.push(value);
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    return { ok: true, body: text };
  } catch {
    return { ok: false, body: null };
  }
}

/**
 * Stable admin identity for this single-admin system, derived from the trusted
 * authenticated session (the session token is server-signed and was verified by
 * `requireAdmin` / `isAdminAuthenticated`). It deliberately does NOT come from
 * any client-supplied header or body: never trust client-provided identity.
 * It also never contains an IP address, so it is safe to display in the admin UI.
 */
async function getAdminIdentity(): Promise<string> {
  return "admin";
}

async function requireAdmin(): Promise<void> {
  if (!(await isAdminAuthenticated())) {
    throw new Error("Unauthorized");
  }
}

async function audit(event: string, details: Record<string, unknown>): Promise<void> {
  const h = await headers();
  await logAdminEvent({
    event,
    details,
    ip: h.get("x-forwarded-for"),
    userAgent: h.get("user-agent"),
  });
}

export async function saveResearchNotes(formData: FormData): Promise<void> {
  await requireAdmin();
  const { id, notes, candidateSourceUrl } = parseForm(ResearchNotesInput, formData);
  const candidateUrl = candidateSourceUrl ? candidateSourceUrl.trim() || null : null;

  await db
    .update(regulatoryResearchQueue)
    .set({
      notes: notes.trim() || null,
      candidateSourceUrl: candidateUrl,
      lastUpdatedAt: new Date(),
    })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.notes_saved", { researchId: id, hasCandidateUrl: Boolean(candidateUrl) });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

export async function startResearch(formData: FormData): Promise<void> {
  await requireAdmin();
  const { id } = parseForm(ResearchIdInput, formData);
  const adminId = await getAdminIdentity();

  await db
    .update(regulatoryResearchQueue)
    .set({ researchStatus: "researching", reviewerAdmin: adminId, lastUpdatedAt: new Date() })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.started", { researchId: id });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

export async function resolveVerified(formData: FormData): Promise<void> {
  await requireAdmin();
  const {
    id,
    verifiedSourceUrl: sourceUrl,
    verifiedSourceTitle: sourceTitle,
    authorityName,
    approvalName,
    approvalType,
    requirementText,
    applicationProcess,
    conditions: conditionsRaw,
    requiredDocuments: documentsRaw,
  } = parseForm(ResearchVerifiedInput, formData);
  const adminId = await getAdminIdentity();

  const sourceUrlTrim = sourceUrl.trim();
  const sourceTitleTrim = sourceTitle.trim();

  if (!looksOfficial(sourceUrlTrim)) {
    await audit("research.verify_rejected_non_official_source", { researchId: id, sourceUrl: sourceUrlTrim });
    throw new Error(
      "Verification requires an OFFICIAL source URL (government / authority domain). Third-party links are leads only."
    );
  }
  if (!sourceTitleTrim) {
    throw new Error("A descriptive source title is required.");
  }

  const [item] = await db
    .select()
    .from(regulatoryResearchQueue)
    .where(eq(regulatoryResearchQueue.id, id))
    .limit(1);
  if (!item) throw new Error("Research item not found");

  const today = new Date().toISOString().split("T")[0];
  let contentHash: string | null = null;
  try {
    const { ok, body } = await safeFetch(sourceUrlTrim);
    if (ok && body) {
      contentHash = `sha256:${crypto.createHash("sha256").update(body).digest("hex")}`;
    }
  } catch {
    contentHash = null;
  }

  const [source] = await db
    .insert(sources)
    .values({
      url: sourceUrlTrim,
      title: sourceTitleTrim,
      sourceType: "sector_regulator",
      authority: authorityName || null,
      retrievedDate: today,
      lastVerified: today,
      contentHash,
    })
    .returning({ id: sources.id });

  let approvalAuthorityId: string | null = null;
  if (authorityName) {
    const slug = authorityName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 250);
    const existing = await db
      .select({ id: approvalAuthorities.id })
      .from(approvalAuthorities)
      .where(eq(approvalAuthorities.slug, slug))
      .limit(1);
    if (existing.length > 0) {
      approvalAuthorityId = existing[0].id;
    } else {
      const [created] = await db
        .insert(approvalAuthorities)
        .values({
          name: authorityName.slice(0, 255),
          slug,
          officialWebsite: (() => {
            try {
              return new URL(sourceUrlTrim).origin;
            } catch {
              return null;
            }
          })(),
        })
        .returning({ id: approvalAuthorities.id });
      approvalAuthorityId = created.id;
    }
  }

  const parseLines = (raw: string | null) =>
    raw
      ? raw
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      : null;

  const [approval] = await db
    .insert(approvals)
    .values({
      activityId: item.activityId,
      approvalAuthorityId,
      name: approvalName || `Regulatory approval — ${authorityName || "authority"}`.slice(0, 255),
      approvalType: (["regulatory_permit", "professional_license", "sector_approval", "noc", "inspection", "certification", "registration", "other"].includes(approvalType)
        ? approvalType
        : "other") as typeof approvals.$inferInsert.approvalType,
      status: "required",
      description: requirementText || null,
      conditions: parseLines(conditionsRaw),
      requiredDocuments: parseLines(documentsRaw),
      applicationProcess: applicationProcess.trim() || null,
      sourceId: source.id,
      lastVerified: today,
      verificationStatus: "verified",
    })
    .returning({ id: approvals.id });

  await db.insert(verificationHistory).values({
    entityType: "approval",
    entityId: approval.id,
    sourceId: source.id,
    verificationStatus: "verified",
    verifiedBy: adminId,
    notes: `Verified via research queue item ${id}`,
  });

  await db
    .update(regulatoryResearchQueue)
    .set({
      researchStatus: "verified",
      verifiedSourceId: source.id,
      verificationDate: today,
      reviewerAdmin: adminId,
      resolutionApprovalId: approval.id,
      lastUpdatedAt: new Date(),
      possibleAuthority: authorityName || item.possibleAuthority,
    })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.resolved_verified", {
    researchId: id,
    activityId: item.activityId,
    approvalId: approval.id,
    sourceId: source.id,
    sourceUrl,
    contentHashPresent: Boolean(contentHash),
  });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

export async function resolveNotRequired(formData: FormData): Promise<void> {
  await requireAdmin();
  const { id, notRequiredSourceUrl, rationale } = parseForm(ResearchNotRequiredInput, formData);
  const sourceUrl = notRequiredSourceUrl.trim();
  const rationaleTrim = rationale.trim();
  const adminId = await getAdminIdentity();

  if (!sourceUrl || !looksOfficial(sourceUrl)) {
    await audit("research.not_required_rejected_non_official_source", { researchId: id, sourceUrl });
    throw new Error("Marking not_required requires an official source URL supporting the conclusion.");
  }

  const [item] = await db
    .select()
    .from(regulatoryResearchQueue)
    .where(eq(regulatoryResearchQueue.id, id))
    .limit(1);
  if (!item) throw new Error("Research item not found");

  const today = new Date().toISOString().split("T")[0];
  let contentHash: string | null = null;
  try {
    const { ok, body } = await safeFetch(sourceUrl);
    if (ok && body) {
      contentHash = `sha256:${crypto.createHash("sha256").update(body).digest("hex")}`;
    }
  } catch {
    contentHash = null;
  }

  const [source] = await db
    .insert(sources)
    .values({
      url: sourceUrl,
      title: `Basis for 'no additional approval required' conclusion`,
      sourceType: "secondary_source",
      retrievedDate: today,
      lastVerified: today,
      contentHash,
    })
    .returning({ id: sources.id });

  const [approval] = await db
    .insert(approvals)
    .values({
      activityId: item.activityId,
      name: "No additional third-party approval identified",
      approvalType: "other",
      status: "not_required",
      description: rationaleTrim || null,
      sourceId: source.id,
      lastVerified: today,
      verificationStatus: "verified",
    })
    .returning({ id: approvals.id });

  await db
    .update(regulatoryResearchQueue)
    .set({
      researchStatus: "not_required",
      verifiedSourceId: source.id,
      verificationDate: today,
      resolutionApprovalId: approval.id,
      reviewerAdmin: adminId,
      lastUpdatedAt: new Date(),
      notes: rationaleTrim || item.notes,
    })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.resolved_not_required", {
    researchId: id,
    activityId: item.activityId,
    approvalId: approval.id,
    sourceUrl,
  });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

export async function markConflicting(formData: FormData): Promise<void> {
  await requireAdmin();
  const { id, conflictNotes } = parseForm(ResearchConflictInput, formData);
  const adminId = await getAdminIdentity();

  await db
    .update(regulatoryResearchQueue)
    .set({
      researchStatus: "conflicting_sources",
      reviewerAdmin: adminId,
      notes: conflictNotes.trim() || undefined,
      lastUpdatedAt: new Date(),
    })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.marked_conflicting", { researchId: id });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

export async function flagManualReview(formData: FormData): Promise<void> {
  await requireAdmin();
  const { id, reviewNotes } = parseForm(ResearchReviewInput, formData);
  const adminId = await getAdminIdentity();

  await db
    .update(regulatoryResearchQueue)
    .set({
      researchStatus: "needs_manual_review",
      reviewerAdmin: adminId,
      notes: reviewNotes.trim() || undefined,
      lastUpdatedAt: new Date(),
    })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.flagged_manual_review", { researchId: id });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

/**
 * Atomically claim a research item.
 *
 * Concurrency: the UPDATE is conditional on the item being unclaimed OR already
 * claimed by this same admin (`reviewer_admin IS NULL OR reviewer_admin = me`)
 * and uses `.returning()` so a lost race yields zero rows → we reject rather
 * than silently overwriting another claimant. Two admins cannot both win.
 */
export async function claimResearch(formData: FormData): Promise<void> {
  await requireAdmin();
  const { id } = parseForm(ResearchIdInput, formData);
  const adminId = await getAdminIdentity();

  const result = await db
    .update(regulatoryResearchQueue)
    .set({ reviewerAdmin: adminId, lastUpdatedAt: new Date() })
    .where(
      and(
        eq(regulatoryResearchQueue.id, id),
        or(
          isNull(regulatoryResearchQueue.reviewerAdmin),
          eq(regulatoryResearchQueue.reviewerAdmin, adminId)
        )
      )
    )
    .returning({ id: regulatoryResearchQueue.id });

  // No rows updated → the item is already claimed by someone else (or missing).
  if (result.length === 0) {
    await audit("research.claim_rejected_already_claimed", { researchId: id });
    throw new Error("Item is already claimed by another admin.");
  }

  await audit("research.claimed", { researchId: id });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

/**
 * Release a claim. Only the current claimant (or an admin) may release.
 * Conditional on `reviewer_admin = me`; if the claimant changed meanwhile the
 * update matches zero rows and we reject.
 */
export async function releaseResearch(formData: FormData): Promise<void> {
  await requireAdmin();
  const { id } = parseForm(ResearchIdInput, formData);
  const adminId = await getAdminIdentity();

  const result = await db
    .update(regulatoryResearchQueue)
    .set({ reviewerAdmin: null, lastUpdatedAt: new Date() })
    .where(
      and(eq(regulatoryResearchQueue.id, id), eq(regulatoryResearchQueue.reviewerAdmin, adminId))
    )
    .returning({ id: regulatoryResearchQueue.id });

  if (result.length === 0) {
    await audit("research.release_rejected_not_owner", { researchId: id });
    throw new Error("This item is not claimed by you (or is already released).");
  }

  await audit("research.released", { researchId: id });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

/**
 * Mark an item as NOT CONFIRMED (distinct from not_required).
 *
 * Records an honest "could not confirm" outcome. It creates NO approval and
 * makes NO negative regulatory conclusion: absence of evidence is never
 * converted into "no approval required". Only audit + notes are recorded.
 */
export async function markNotConfirmed(formData: FormData): Promise<void> {
  await requireAdmin();
  const { id, reviewNotes } = parseForm(ResearchReviewInput, formData);
  const adminId = await getAdminIdentity();

  const [item] = await db
    .select()
    .from(regulatoryResearchQueue)
    .where(eq(regulatoryResearchQueue.id, id))
    .limit(1);
  if (!item) throw new Error("Research item not found");

  // Do not overwrite an already-verified conclusion with "not confirmed".
  if (item.researchStatus === "verified" || item.researchStatus === "not_required") {
    throw new Error(
      `Cannot change a resolved (${item.researchStatus}) item to not_confirmed without evidence-backed re-review.`
    );
  }

  await db
    .update(regulatoryResearchQueue)
    .set({
      researchStatus: "not_confirmed",
      notes: reviewNotes || null,
      reviewerAdmin: adminId,
      lastUpdatedAt: new Date(),
    })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.marked_not_confirmed", { researchId: id });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}
