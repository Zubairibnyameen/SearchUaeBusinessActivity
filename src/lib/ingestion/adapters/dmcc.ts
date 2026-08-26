/**
 * DMCC adapter — official XLSX activity list.
 *
 * Source: https://dmcc.ae/hubfs/website%20support%20documents/License%20Activity%2015%20OCT%202025.xlsx
 * Already imported once (1,002 activities). This adapter exists so future
 * refreshes go through the common pipeline instead of a one-off script.
 */

import * as XLSX from "xlsx";
import { fetchOfficial } from "../http";
import { cleanText, isTruthyFlag, normalizeName, parseAmount } from "../normalize";
import type {
  DiscoveredSource,
  FetchedPayload,
  OfficialActivitySourceAdapter,
  ParsedActivity,
} from "../types";

const SOURCE_URL =
  "https://dmcc.ae/hubfs/website%20support%20documents/License%20Activity%2015%20OCT%202025.xlsx";

interface DmccRow {
  businessSector: string;
  subSector: string;
  isicCode: string;
  activityCode: string;
  activityName: string;
  activityNameArabic: string;
  licenseType: string;
  activityDescription: string;
  propertyRequired: string;
  restrictions: string;
  additionalRequirements: string;
  minimumShareCapital: number | null;
  thirdPartyApprovalRequired: string;
}

function mapRow(raw: Record<string, unknown>): DmccRow {
  return {
    businessSector: String(raw["__EMPTY_2"] ?? "").trim(),
    subSector: String(raw["__EMPTY_3"] ?? "").trim(),
    isicCode: String(raw["__EMPTY_4"] ?? "").trim(),
    activityCode: String(raw["__EMPTY_5"] ?? "").trim(),
    activityName: String(raw["__EMPTY_6"] ?? "").trim(),
    activityNameArabic: String(raw["__EMPTY_7"] ?? "").trim(),
    licenseType: String(raw["__EMPTY_8"] ?? "").trim(),
    activityDescription: String(raw["__EMPTY_9"] ?? "").trim(),
    propertyRequired: String(raw["__EMPTY_10"] ?? "").trim(),
    restrictions: String(raw["__EMPTY_11"] ?? "").trim(),
    additionalRequirements: String(raw["__EMPTY_12"] ?? "").trim(),
    minimumShareCapital:
      raw["__EMPTY_13"] !== undefined && raw["__EMPTY_13"] !== ""
        ? Number(raw["__EMPTY_13"])
        : null,
    thirdPartyApprovalRequired: String(raw["__EMPTY_14"] ?? "").trim(),
  };
}

export const dmccAdapter: OfficialActivitySourceAdapter = {
  meta: {
    jurisdictionSlug: "dmcc",
    jurisdictionName: "DMCC",
    emirate: "dubai",
    jurisdictionType: "free_zone",
    authorityName: "Dubai Multi Commodities Centre",
    authorityWebsite: "https://www.dmcc.ae",
    sourceType: "free_zone_authority",
  },

  async discover(): Promise<DiscoveredSource[]> {
    return [
      {
        id: "dmcc-activities",
        label: "DMCC Approved List of Activities (October 2025)",
        url: SOURCE_URL,
        format: "xlsx",
        notes: "Official DMCC XLSX; first sheet, headers in row 1, data from row 2 (__EMPTY_N columns).",
      },
    ];
  },

  async fetch(source: DiscoveredSource): Promise<FetchedPayload> {
    // Offline fallback to the cached official copy used for the initial import.
    if (process.env.DMCC_LOCAL_FILE) {
      const fs = await import("fs");
      const body = fs.readFileSync(process.env.DMCC_LOCAL_FILE);
      return {
        discovery: source,
        body,
        filename: "dmcc-activities.xlsx",
        fetchedAt: new Date(),
        httpStatus: 200,
        finalUrl: source.url,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }
    return fetchOfficial(source);
  },

  async parse(payload: FetchedPayload): Promise<ParsedActivity[]> {
    const wb = XLSX.read(payload.body);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];

    const out: ParsedActivity[] = [];
    for (const r of rows.slice(1)) {
      const m = mapRow(r);
      if (!m.activityCode || !m.activityName) continue;

      const approval = isTruthyFlag(m.thirdPartyApprovalRequired)
        ? {
            signal: "third_party_approval_indicated" as const,
            signalType: "third_party_approval_required" as const,
            notes: "Third Party Approval flag = Y in official DMCC list",
          }
        : {
            signal: "no_signal" as const,
            signalType: undefined,
            notes: "Third Party Approval flag not set in official DMCC list",
          };

      out.push({
        raw: r as Record<string, unknown>,
        activityCode: m.activityCode,
        isicCode: m.isicCode || undefined,
        officialName: m.activityName,
        officialNameAr: m.activityNameArabic || undefined,
        description: cleanText(m.activityDescription),
        officialCategory: cleanText(m.businessSector),
        activityGroup: cleanText(m.subSector),
        licenceLabel: m.licenseType || undefined,
        approval,
        restrictions: cleanText(m.restrictions),
        extras: {
          propertyRequired: cleanText(m.propertyRequired),
          additionalRequirements: cleanText(m.additionalRequirements),
          minimumShareCapital: m.minimumShareCapital,
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
      signalDetail: a.approval
        ? { ...a.approval, signal: a.approval.signal }
        : undefined,
      sourceExtra: a.extras,
      raw: a.raw,
    };
  },
};
