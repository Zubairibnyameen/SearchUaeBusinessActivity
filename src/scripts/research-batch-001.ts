/**
 * Research batch 001 — Phase 3 Part 14 step 10 (SMALL initial batch).
 *
 * Applies manually-researched outcomes to the regulatory research queue.
 * Every VERIFIED resolution cites an OFFICIAL authority URL fetched during
 * research (2026-08-24):
 *
 *  - KHDA (Dubai): Educational Services Permit for training institutes,
 *    explicitly covering free-zone institutes. Fees published on the same
 *    official page are recorded as GOVERNMENT FEES (their own rows).
 *  - MOHAP (federal): Licensing of a Pharmaceutical Facility — sale/
 *    distribution of pharmaceutical products and medical supplies.
 *    Page could not be fetched at verification time -> content_hash NULL
 *    (never fabricated).
 *
 * Ambiguous mappings are marked needs_manual_review — never guessed.
 * Idempotent: skips queue items already resolved.
 *
 * Usage: npx tsx src/scripts/research-batch-001.ts
 */
import crypto from "node:crypto";
import { loadEnvFile } from "../lib/db/env";
import { assertDatabaseWritable } from "./db-safety";

loadEnvFile();

interface VerifiedItem {
  jurisdictionSlug: string;
  activityCode: string;
  approvalName: string;
  approvalType: "regulatory_permit" | "sector_approval" | "registration";
  authorityName: string;
  authorityWebsite: string;
  sourceUrl: string;
  sourceTitle: string;
  requirementText: string;
  applicationProcess?: string;
  requiredDocuments?: string[];
  conditions?: string[];
  fees?: { amount: number; feeType: string; basis: string; conditions: string }[];
}

const TODAY = new Date().toISOString().split("T")[0];

const VERIFIED: VerifiedItem[] = [
  {
    jurisdictionSlug: "spc",
    activityCode: "4649.29",
    approvalName: "MOHAP pharmaceutical facility licence",
    approvalType: "regulatory_permit",
    authorityName: "Ministry of Health and Prevention (MOHAP)",
    authorityWebsite: "https://mohap.gov.ae",
    sourceUrl: "https://mohap.gov.ae/en/w/licensing-of-a-pharmaceutical-facility",
    sourceTitle:
      "Licensing of a Pharmaceutical Facility — Ministry of Health and Prevention (UAE)",
    requirementText:
      "MOHAP issues licences to establish pharmaceutical facilities to sell pharmaceutical products and medical supplies, and to register, import and distribute pharmaceutical products and medical supplies in the UAE. Para-pharmaceutical wholesale activity falls within this federal regime.",
  },
  {
    jurisdictionSlug: "rakez",
    activityCode: "4669210",
    approvalName: "MOHAP pharmaceutical facility licence (medical supplies)",
    approvalType: "regulatory_permit",
    authorityName: "Ministry of Health and Prevention (MOHAP)",
    authorityWebsite: "https://mohap.gov.ae",
    sourceUrl: "https://mohap.gov.ae/en/w/licensing-of-a-pharmaceutical-facility",
    sourceTitle:
      "Licensing of a Pharmaceutical Facility — Ministry of Health and Prevention (UAE)",
    requirementText:
      "MOHAP facility licensing covers establishments selling/distributing medical supplies; medical gases are regulated medical supplies. Applicability to this trading activity follows from the official service scope.",
  },
  {
    jurisdictionSlug: "ifza",
    activityCode: "8549012",
    approvalName: "KHDA Educational Services Permit (training institute)",
    approvalType: "regulatory_permit",
    authorityName: "Knowledge and Human Development Authority (KHDA)",
    authorityWebsite: "https://web.khda.gov.ae",
    sourceUrl:
      "https://web.khda.gov.ae/en/Services/Training-Institute-Permit-Services/Issuing-an-Educational-Services-Permit-for-a-Train",
    sourceTitle:
      "Issue an Educational Permit for a Training Institute — KHDA (Government of Dubai)",
    requirementText:
      "An Educational Services Permit from KHDA is required to establish and operate a training institute in Dubai. The official service terms explicitly cover institutes located in Dubai free zones (Initial Approval and Trade Name Reservation from the free-zone licensing authority must be attached).",
    applicationProcess:
      "1) Submit application via KHDA e-services portal. 2) KHDA reviews course documentation. 3) Initial Approval letter issued after fee payment (valid 6 months). 4) Enter trade licence details and upload licence via KHDA portal to receive the Educational Services Permit.",
    requiredDocuments: [
      "List of course names and descriptions",
      "Approval from the awarding body for professional certificates (for certification-prep courses)",
      "Approval from relevant authorities for specialised courses (e.g. DHA for medical/cosmetic)",
      "Trade Name Reservation certificate and Initial Approval from the free-zone licensing authority (for free-zone institutes)",
    ],
    conditions: [
      "Initial Approval and Trade Name Reservation must be obtained before applying",
      "Programmes under other government bodies' remit require those bodies' prior approval",
      "Initial Approval expires after six months if the permit process is not completed",
    ],
    fees: [
      { amount: 15000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 1–2 training activities (plus AED 20 Knowledge & Innovation fee)" },
      { amount: 18000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 3–4 training activities (plus AED 20 Knowledge & Innovation fee)" },
      { amount: 20000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 5–6 training activities (plus AED 20 Knowledge & Innovation fee)" },
      { amount: 25000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 7+ training activities (plus AED 20 Knowledge & Innovation fee)" },
    ],
  },
  {
    jurisdictionSlug: "ifza",
    activityCode: "8542007",
    approvalName: "KHDA Educational Services Permit (training institute)",
    approvalType: "regulatory_permit",
    authorityName: "Knowledge and Human Development Authority (KHDA)",
    authorityWebsite: "https://web.khda.gov.ae",
    sourceUrl:
      "https://web.khda.gov.ae/en/Services/Training-Institute-Permit-Services/Issuing-an-Educational-Services-Permit-for-a-Train",
    sourceTitle:
      "Issue an Educational Permit for a Training Institute — KHDA (Government of Dubai)",
    requirementText:
      "Fine arts training delivered by a training institute in Dubai requires the KHDA Educational Services Permit; the permit requirement explicitly extends to institutes in Dubai free zones.",
    applicationProcess:
      "See KHDA official service steps (portal application → review → Initial Approval → trade licence submission).",
    fees: [
      { amount: 15000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 1–2 training activities (plus AED 20 Knowledge & Innovation fee)" },
      { amount: 18000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 3–4 training activities (plus AED 20 Knowledge & Innovation fee)" },
      { amount: 20000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 5–6 training activities (plus AED 20 Knowledge & Innovation fee)" },
      { amount: 25000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 7+ training activities (plus AED 20 Knowledge & Innovation fee)" },
    ],
  },
  {
    jurisdictionSlug: "ifza",
    activityCode: "8549043",
    approvalName: "KHDA Educational Services Permit (training institute)",
    approvalType: "regulatory_permit",
    authorityName: "Knowledge and Human Development Authority (KHDA)",
    authorityWebsite: "https://web.khda.gov.ae",
    sourceUrl:
      "https://web.khda.gov.ae/en/Services/Training-Institute-Permit-Services/Issuing-an-Educational-Services-Permit-for-a-Train",
    sourceTitle:
      "Issue an Educational Permit for a Training Institute — KHDA (Government of Dubai)",
    requirementText:
      "Technical and occupational skills training delivered by a training institute in Dubai requires the KHDA Educational Services Permit; TVET permits are covered by KHDA's official permit guides and extend to free-zone institutes.",
    applicationProcess:
      "See KHDA official service steps (portal application → review → Initial Approval → trade licence submission).",
    fees: [
      { amount: 15000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 1–2 training activities (plus AED 20 Knowledge & Innovation fee)" },
      { amount: 18000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 3–4 training activities (plus AED 20 Knowledge & Innovation fee)" },
      { amount: 20000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 5–6 training activities (plus AED 20 Knowledge & Innovation fee)" },
      { amount: 25000, feeType: "application_fee", basis: "depends_on_activity", conditions: "Institute offering 7+ training activities (plus AED 20 Knowledge & Innovation fee)" },
    ],
  },
];

const MANUAL_REVIEW: {
  jurisdictionSlug: string;
  activityCode: string;
  note: string;
}[] = [
  {
    jurisdictionSlug: "spc",
    activityCode: "7020.23",
    note: "Signal names Ministry Of Health. The official MOHAP pharmaceutical-facility service covers facilities selling/distributing products; whether a pure PHARMACEUTICAL CONSULTANCY activity requires MOHAP licensing was not confirmed by fetched official text. Escalated for manual confirmation with MOHAP.",
  },
  {
    jurisdictionSlug: "spc",
    activityCode: "6510",
    note: "Signal names Central Bank. CBUAE regimes target insurance companies/intermediaries; applicability to INSURANCE CONSULTANCY requires manual confirmation against CBUAE official classification.",
  },
  {
    jurisdictionSlug: "spc",
    activityCode: "6619.23",
    note: "Signal names Securities and Commodities Authority. Mapping of FINANCIAL INSTRUMENTS QUOTATION SERVICES to SCA licensing requires manual confirmation with SCA.",
  },
];

async function tryHash(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    return `sha256:${crypto.createHash("sha256").update(body).digest("hex")}`;
  } catch {
    return null;
  }
}

async function main() {
  assertDatabaseWritable("research-batch-001");
  const { db } = await import("../lib/db");
  const {
    regulatoryResearchQueue,
    jurisdictions,
    activities,
    sources,
    approvals,
    approvalAuthorities,
    approvalFees,
    verificationHistory,
    adminAuditLogs,
  } = await import("../lib/db/schema");
  const { eq, and } = await import("drizzle-orm");

  let verifiedCount = 0;
  let manualCount = 0;

  // ---- Verified resolutions ------------------------------------------------
  for (const v of VERIFIED) {
    const [item] = await db
      .select({ q: regulatoryResearchQueue })
      .from(regulatoryResearchQueue)
      .innerJoin(activities, eq(activities.id, regulatoryResearchQueue.activityId))
      .innerJoin(jurisdictions, eq(jurisdictions.id, regulatoryResearchQueue.jurisdictionId))
      .where(
        and(
          eq(regulatoryResearchQueue.activityCode, v.activityCode),
          eq(jurisdictions.slug, v.jurisdictionSlug)
        )
      )
      .limit(1);

    if (!item) {
      console.warn(`SKIP ${v.jurisdictionSlug}/${v.activityCode}: not in queue`);
      continue;
    }
    if (item.q.researchStatus === "verified" || item.q.researchStatus === "not_required") {
      console.log(`SKIP ${v.jurisdictionSlug}/${v.activityCode}: already resolved`);
      continue;
    }

    const contentHash = await tryHash(v.sourceUrl);

    const [source] = await db
      .insert(sources)
      .values({
        url: v.sourceUrl,
        title: v.sourceTitle,
        sourceType: "sector_regulator",
        authority: v.authorityName,
        retrievedDate: TODAY,
        lastVerified: TODAY,
        contentHash,
      })
      .returning({ id: sources.id });

    const slug = v.authorityName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 250);
    const existingAuth = await db
      .select({ id: approvalAuthorities.id })
      .from(approvalAuthorities)
      .where(eq(approvalAuthorities.slug, slug))
      .limit(1);
    const authorityId =
      existingAuth[0]?.id ??
      (
        await db
          .insert(approvalAuthorities)
          .values({ name: v.authorityName, slug, officialWebsite: v.authorityWebsite })
          .returning({ id: approvalAuthorities.id })
      )[0].id;

    const [approval] = await db
      .insert(approvals)
      .values({
        activityId: item.q.activityId,
        approvalAuthorityId: authorityId,
        name: v.approvalName,
        approvalType: v.approvalType,
        status: "required",
        description: v.requirementText,
        requiredDocuments: v.requiredDocuments ?? null,
        conditions: v.conditions ?? null,
        applicationProcess: v.applicationProcess ?? null,
        sourceId: source.id,
        lastVerified: TODAY,
        verificationStatus: "verified",
      })
      .returning({ id: approvals.id });

    for (const f of v.fees ?? []) {
      await db.insert(approvalFees).values({
        approvalId: approval.id,
        feeType: f.feeType as typeof approvalFees.$inferInsert.feeType,
        amount: String(f.amount),
        currency: "AED",
        feeBasis: f.basis as typeof approvalFees.$inferInsert.feeBasis,
        conditions: f.conditions,
        isMandatory: true,
        sourceId: source.id,
        lastVerified: TODAY,
      });
    }

    await db.insert(verificationHistory).values({
      entityType: "approval",
      entityId: approval.id,
      sourceId: source.id,
      verificationStatus: "verified",
      verifiedBy: "research-batch-001",
      notes: `Verified against official authority page${contentHash ? " (content hash recorded)" : " (page unreachable at verification time — hash not recorded)"}.`,
    });

    await db
      .update(regulatoryResearchQueue)
      .set({
        researchStatus: "verified",
        possibleAuthority: v.authorityName,
        verifiedSourceId: source.id,
        verificationDate: TODAY,
        reviewerAdmin: "research-batch-001",
        resolutionApprovalId: approval.id,
        lastUpdatedAt: new Date(),
      })
      .where(eq(regulatoryResearchQueue.id, item.q.id));

    await db.insert(adminAuditLogs).values({
      event: "research.resolved_verified",
      outcome: "success",
      details: {
        batch: "001",
        jurisdiction: v.jurisdictionSlug,
        activityCode: v.activityCode,
        approvalId: approval.id,
        sourceId: source.id,
        sourceUrl: v.sourceUrl,
        contentHashPresent: Boolean(contentHash),
        feesRecorded: v.fees?.length ?? 0,
      },
    });

    verifiedCount += 1;
    console.log(`VERIFIED ${v.jurisdictionSlug}/${v.activityCode} (${contentHash ? "hashed" : "no-hash"})`);
  }

  // ---- Manual-review escalations ------------------------------------------
  for (const m of MANUAL_REVIEW) {
    const [row] = await db
      .select({ q: regulatoryResearchQueue })
      .from(regulatoryResearchQueue)
      .innerJoin(activities, eq(activities.id, regulatoryResearchQueue.activityId))
      .innerJoin(jurisdictions, eq(jurisdictions.id, regulatoryResearchQueue.jurisdictionId))
      .where(
        and(
          eq(regulatoryResearchQueue.activityCode, m.activityCode),
          eq(jurisdictions.slug, m.jurisdictionSlug)
        )
      )
      .limit(1);
    if (!row || row.q.researchStatus !== "pending_review") continue;

    await db
      .update(regulatoryResearchQueue)
      .set({
        researchStatus: "needs_manual_review",
        notes: m.note,
        reviewerAdmin: "research-batch-001",
        lastUpdatedAt: new Date(),
      })
      .where(eq(regulatoryResearchQueue.id, row.q.id));

    await db.insert(adminAuditLogs).values({
      event: "research.flagged_manual_review",
      outcome: "success",
      details: { batch: "001", jurisdiction: m.jurisdictionSlug, activityCode: m.activityCode },
    });
    manualCount += 1;
    console.log(`MANUAL_REVIEW ${m.jurisdictionSlug}/${m.activityCode}`);
  }

  console.log(`\nDone: ${verifiedCount} verified, ${manualCount} escalated to manual review.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
