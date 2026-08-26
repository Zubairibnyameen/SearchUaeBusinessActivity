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
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

/**
 * Hostname allowlist for VERIFIED claims, mirroring Part 3's authority
 * priority order: UAE federal/emirate government domains, official
 * regulators, and the five indexed free-zone authorities' own domains.
 */
const OFFICIAL_HOST_PATTERNS = [
  /\.gov\.ae$/,
  /\.(gov|mil)$/,
  /^(www\.)?(dmcc|ifza|rakez|spcfz|spcfreezone|ajmanfreezones|afz)\./,
  /^(www\.)?(mohap|dha|tdra|khda|dcaa|sira|ded|municipality|centralbank|vara|scasec|uiae)\./,
];

function looksOfficial(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
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
  const id = String(formData.get("id") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const candidateUrl = String(formData.get("candidateSourceUrl") ?? "").trim() || null;

  await db
    .update(regulatoryResearchQueue)
    .set({
      notes: notes || null,
      candidateSourceUrl: candidateUrl,
      lastUpdatedAt: new Date(),
    })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.notes_saved", { researchId: id, hasCandidateUrl: Boolean(candidateUrl) });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

/** Move an item into active research without making any regulatory claim. */
export async function startResearch(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");

  await db
    .update(regulatoryResearchQueue)
    .set({ researchStatus: "researching", reviewerAdmin: "admin", lastUpdatedAt: new Date() })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.started", { researchId: id });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

/**
 * Resolve a research item as VERIFIED.
 *
 * Requires an official source URL (government/authority domain). The source
 * is stored with retrieved date + content hash of a HEAD-level fetch result
 * when practical; the approval record is created with verification_status =
 * 'verified' and linked back to the queue item.
 */
export async function resolveVerified(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const sourceUrl = String(formData.get("verifiedSourceUrl") ?? "").trim();
  const sourceTitle = String(formData.get("verifiedSourceTitle") ?? "").trim();
  const authorityName = String(formData.get("authorityName") ?? "").trim();
  const approvalName = String(formData.get("approvalName") ?? "").trim();
  const approvalType = String(formData.get("approvalType") ?? "other");
  const requirementText = String(formData.get("requirementText") ?? "").trim();
  const applicationProcess = String(formData.get("applicationProcess") ?? "").trim() || null;
  const conditionsRaw = String(formData.get("conditions") ?? "").trim();
  const documentsRaw = String(formData.get("requiredDocuments") ?? "").trim();

  if (!sourceUrl || !looksOfficial(sourceUrl)) {
    await audit("research.verify_rejected_non_official_source", { researchId: id, sourceUrl });
    throw new Error(
      "Verification requires an OFFICIAL source URL (government / authority domain). Third-party links are leads only."
    );
  }
  if (!sourceTitle) {
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
    // Practical traceability: hash the fetched page content when reachable.
    const res = await fetch(sourceUrl, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const body = await res.text();
      contentHash = `sha256:${crypto.createHash("sha256").update(body).digest("hex")}`;
    }
  } catch {
    contentHash = null; // recorded as null — never fabricated
  }

  const [source] = await db
    .insert(sources)
    .values({
      url: sourceUrl,
      title: sourceTitle,
      sourceType: "sector_regulator",
      authority: authorityName || null,
      retrievedDate: today,
      lastVerified: today,
      contentHash,
    })
    .returning({ id: sources.id });

  // Upsert authority by slug so repeated verifications reuse it.
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
              return new URL(sourceUrl).origin;
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
      applicationProcess,
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
    verifiedBy: "admin",
    notes: `Verified via research queue item ${id}`,
  });

  await db
    .update(regulatoryResearchQueue)
    .set({
      researchStatus: "verified",
      verifiedSourceId: source.id,
      verificationDate: today,
      reviewerAdmin: "admin",
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

/**
 * Resolve as NOT REQUIRED — must still cite an official basis (e.g. the
 * free-zone source itself stating no third-party approval applies).
 */
export async function resolveNotRequired(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const sourceUrl = String(formData.get("notRequiredSourceUrl") ?? "").trim();
  const rationale = String(formData.get("rationale") ?? "").trim();

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
  const [source] = await db
    .insert(sources)
    .values({
      url: sourceUrl,
      title: `Basis for 'no additional approval required' conclusion`,
      sourceType: "secondary_source",
      retrievedDate: today,
      lastVerified: today,
    })
    .returning({ id: sources.id });

  const [approval] = await db
    .insert(approvals)
    .values({
      activityId: item.activityId,
      name: "No additional third-party approval identified",
      approvalType: "other",
      status: "not_required",
      description: rationale || null,
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
      reviewerAdmin: "admin",
      lastUpdatedAt: new Date(),
      notes: rationale || item.notes,
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

/** Conflicting sources found — keep unresolved, never delete. */
export async function markConflicting(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const conflictNotes = String(formData.get("conflictNotes") ?? "").trim();

  await db
    .update(regulatoryResearchQueue)
    .set({
      researchStatus: "conflicting_sources",
      reviewerAdmin: "admin",
      notes: conflictNotes || undefined,
      lastUpdatedAt: new Date(),
    })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.marked_conflicting", { researchId: id });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

/** Escalate for manual review. */
export async function flagManualReview(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const reviewNotes = String(formData.get("reviewNotes") ?? "").trim();

  await db
    .update(regulatoryResearchQueue)
    .set({
      researchStatus: "needs_manual_review",
      reviewerAdmin: "admin",
      notes: reviewNotes || undefined,
      lastUpdatedAt: new Date(),
    })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.flagged_manual_review", { researchId: id });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}
