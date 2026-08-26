/**
 * IFZA adapter — official Business Activities register (public JSON API).
 *
 * Endpoint: https://one.ifza.com/api/utils/getBusinessActivities
 * Identified from the activities.ifza.com app bundle
 * (/assets/index-IuK805-d.js), which loads the ENTIRE register with a single
 * unauthenticated GET and filters client-side (`Activity_Status==="Active"`).
 * No pagination, no auth, no rate-limiting encountered; one polite request
 * returns all 826 records × 31 fields. Fetch-method tier: public API/XHR used
 * by the official site.
 *
 * Field notes:
 *  - No Arabic activity names are published → officialNameAr stays empty.
 *  - `TPA` + Approving_Entity_1/2 (+ Approval_Entity_1/2 process data) are
 *    stored as approval SIGNALS only — never as verified approvals.
 *  - Third-party fee mentions inside free-text process descriptions are kept
 *    verbatim in extras; no structured price rows are fabricated because the
 *    source publishes no per-activity IFZA price field.
 */

import { fetchOfficial } from "../http";
import { cleanText, normalizeName } from "../normalize";
import type {
  DiscoveredSource,
  FetchedPayload,
  OfficialActivitySourceAdapter,
  ParsedActivity,
} from "../types";

const ENDPOINT_URL = "https://one.ifza.com/api/utils/getBusinessActivities";

interface IfzaRecord extends Record<string, unknown> {
  ID?: string;
  ZCRM_ID?: string;
  Activity_Name?: string;
  Description?: string;
  Activity_Code?: string;
  DED_Code?: string;
  DED_License_Type?: string;
  Activity_Type?: string;
  Activity_Status?: string;
  E_Channel_Number?: string;
  Integration_Key?: string;
  TPA?: string;
  Required_Prior_TL_Issuance?: string;
  Approval_Requirements?: string;
  Special_Notes?: string;
  Property_Requirements?: string;
  Approving_Entity_1?: string;
  Approving_Entity_2?: string;
  Added_Time?: string;
  Approval_Entity_1?: string;
  Approval_Entity1_Document_Link?: string;
  Approval_Entity1_Process_Description?: string;
  Approval_Entity1_Process_Document?: string;
  Approval_Entity_2?: string;
  Approval_Entity2_Document_Link?: string;
  Approval_Entity2_Process_Description?: string;
  Approval_Entity2_Process_Document?: string;
  Category?: string;
  Activity_Domain?: string;
  Approval_Process_Document?: string;
  Approval_Process?: string;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export const ifzaAdapter: OfficialActivitySourceAdapter = {
  meta: {
    jurisdictionSlug: "ifza",
    jurisdictionName: "IFZA",
    emirate: "dubai",
    jurisdictionType: "free_zone",
    authorityName: "International Free Zone Authority",
    authorityWebsite: "https://www.ifza.com/",
    sourceType: "free_zone_authority",
  },

  async discover(): Promise<DiscoveredSource[]> {
    return [
      {
        id: "ifza-business-activities",
        label: "IFZA Business Activities register (official public API)",
        url: ENDPOINT_URL,
        format: "json",
        notes:
          "Single unauthenticated GET consumed by activities.ifza.com itself; full dataset, no pagination.",
      },
    ];
  },

  async fetch(source: DiscoveredSource): Promise<FetchedPayload> {
    // Offline fallback to the preserved canonical copy.
    if (process.env.IFZA_LOCAL_FILE) {
      const fs = await import("fs");
      const body = fs.readFileSync(process.env.IFZA_LOCAL_FILE);
      return {
        discovery: source,
        body,
        filename: "ifza-business-activities.json",
        fetchedAt: new Date(),
        httpStatus: 200,
        finalUrl: source.url,
        contentType: "application/json; charset=utf-8",
      };
    }
    return fetchOfficial(source, { headers: { Accept: "application/json" } });
  },

  async parse(payload: FetchedPayload): Promise<ParsedActivity[]> {
    const data = JSON.parse(payload.body.toString("utf-8")) as IfzaRecord[];
    if (!Array.isArray(data)) {
      throw new Error("IFZA endpoint returned non-array payload");
    }

    const out: ParsedActivity[] = [];
    for (const r of data) {
      const name = str(r.Activity_Name);
      const code = str(r.Activity_Code);
      if (!code && !name) continue;

      const approving1 = str(r.Approving_Entity_1);
      const approving2 = str(r.Approving_Entity_2);
      const tpa = str(r.TPA).toLowerCase() === "true";
      const authorityName =
        approving1 || str(r.Approval_Entity_1) || undefined;

      const approval = tpa || approving1 || approving2
        ? {
            signal: "third_party_approval_indicated" as const,
            signalType: "third_party_approval_required" as const,
            authorityName,
            notes: [
              tpa ? "TPA flag set in official IFZA register" : null,
              approving1 ? `Approving entity 1: ${approving1}` : null,
              approving2 ? `Approving entity 2: ${approving2}` : null,
              str(r.Approval_Requirements)
                ? `Timing: ${str(r.Approval_Requirements)}`
                : null,
            ]
              .filter(Boolean)
              .join("; "),
          }
        : {
            signal: "no_signal" as const,
            signalType: undefined,
            notes: "No TPA flag or approving entity in official IFZA register",
          };

      const priorTl = str(r.Required_Prior_TL_Issuance).toLowerCase() === "true";

      out.push({
        raw: r as Record<string, unknown>,
        activityCode: code || undefined,
        officialName: name,
        description: cleanText(str(r.Description)),
        licenceLabel: str(r.DED_License_Type) || undefined,
        approval,
        restrictions: priorTl
          ? "Required_Prior_TL_Issuance flag set in official IFZA register"
          : undefined,
        extras: {
          ifzaId: str(r.ID) || undefined,
          zcrmId: str(r.ZCRM_ID) || undefined,
          dedCode: str(r.DED_Code) || undefined,
          activityType: str(r.Activity_Type) || undefined,
          sourceStatus: str(r.Activity_Status) || undefined,
          eChannelNumber: str(r.E_Channel_Number) || undefined,
          integrationKey: str(r.Integration_Key) || undefined,
          requiredPriorTlIssuance: priorTl || undefined,
          approvalRequirements: str(r.Approval_Requirements) || undefined,
          specialNotes: cleanText(str(r.Special_Notes)) || undefined,
          propertyRequirements: cleanText(str(r.Property_Requirements)) || undefined,
          approvingEntity1: approving1 || undefined,
          approvingEntity2: approving2 || undefined,
          approvalEntity1: str(r.Approval_Entity_1) || undefined,
          approvalEntity1DocumentLink: str(r.Approval_Entity1_Document_Link) || undefined,
          approvalEntity1ProcessDescription:
            cleanText(str(r.Approval_Entity1_Process_Description)) || undefined,
          approvalEntity1ProcessDocument:
            str(r.Approval_Entity1_Process_Document) || undefined,
          approvalEntity2: str(r.Approval_Entity_2) || undefined,
          approvalEntity2DocumentLink: str(r.Approval_Entity2_Document_Link) || undefined,
          approvalEntity2ProcessDescription:
            cleanText(str(r.Approval_Entity2_Process_Description)) || undefined,
          approvalEntity2ProcessDocument:
            str(r.Approval_Entity2_Process_Document) || undefined,
          category: str(r.Category) || undefined,
          activityDomain: str(r.Activity_Domain) || undefined,
          approvalProcessDocument: str(r.Approval_Process_Document) || undefined,
          approvalProcess: cleanText(str(r.Approval_Process)) || undefined,
          addedTime: str(r.Added_Time) || undefined,
        },
      });
    }
    return out;
  },

  normalize(a: ParsedActivity) {
    return {
      activityCode: a.activityCode,
      isicCode: a.isicCode,
      officialName: a.officialName,
      normalizedName: normalizeName(a.officialName),
      officialNameAr: a.officialNameAr,
      description: a.description,
      officialCategory: a.officialCategory,
      normalizedCategory: a.officialCategory?.toLowerCase(),
      activityGroup: a.activityGroup,
      activitySubcategory: a.activitySubcategory,
      licenceLabel: a.licenceLabel,
      zone: a.zone,
      restrictions: a.restrictions,
      approvalSignal: a.approval?.signal ?? "unknown",
      price: a.price,
      prices: a.prices,
      signalDetail: a.approval
        ? { ...a.approval, signal: a.approval.signal }
        : undefined,
      sourceExtra: a.extras,
      raw: a.raw,
    };
  },
};
