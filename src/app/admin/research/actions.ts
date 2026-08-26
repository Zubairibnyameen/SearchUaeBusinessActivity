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

async function getAdminIdentity(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "admin";
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

export async function startResearch(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
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
  const adminId = await getAdminIdentity();

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
      title: sourceTitle,
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
  const id = String(formData.get("id") ?? "");
  const sourceUrl = String(formData.get("notRequiredSourceUrl") ?? "").trim();
  const rationale = String(formData.get("rationale") ?? "").trim();
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
      reviewerAdmin: adminId,
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

export async function markConflicting(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const conflictNotes = String(formData.get("conflictNotes") ?? "").trim();
  const adminId = await getAdminIdentity();

  await db
    .update(regulatoryResearchQueue)
    .set({
      researchStatus: "conflicting_sources",
      reviewerAdmin: adminId,
      notes: conflictNotes || undefined,
      lastUpdatedAt: new Date(),
    })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.marked_conflicting", { researchId: id });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}

export async function flagManualReview(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const reviewNotes = String(formData.get("reviewNotes") ?? "").trim();
  const adminId = await getAdminIdentity();

  await db
    .update(regulatoryResearchQueue)
    .set({
      researchStatus: "needs_manual_review",
      reviewerAdmin: adminId,
      notes: reviewNotes || undefined,
      lastUpdatedAt: new Date(),
    })
    .where(eq(regulatoryResearchQueue.id, id));

  await audit("research.flagged_manual_review", { researchId: id });
  revalidatePath(`/admin/research/${id}`);
  revalidatePath("/admin/research");
}
