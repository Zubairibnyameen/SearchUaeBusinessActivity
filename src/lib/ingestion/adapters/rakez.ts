/**
 * RAKEZ adapter — official Activity Master register (XLSX export).
 *
 * Primary source: the authority's Activity Master export (3,615 rows × 15
 * columns: AM number, Zone, Activity Code, names EN/AR, Status, Minimum
 * Share Capital, License Type, ESR flag, Is Special, Activity Price,
 * Activity Group, Description, Qualification Requirement, Documents
 * Required). The export was provided directly by RAKEZ for this research
 * project and is preserved byte-for-byte under data/raw/rakez/.
 *
 * Why not the public website: rakez.com serves the register through a
 * DotNetNuke WebForms module whose pagination is non-functional server-side
 * — pager anchors carry onclick="return false;" and both full and MS AJAX
 * postbacks re-render page 1 regardless of target (verified against live
 * responses on 2026-08-23/24; crawl attempts preserved in
 * data/raw/rakez/2026-08-23/). The published PDFs date from 2020.
 *
 * Zone classification ("Freezone" / "Non-Freezone" / "Freelance Permit")
 * is kept verbatim per activity. "Documents Required" entries that name a
 * government entity produce third_party_approval_indicated signals; pure
 * document/fee notes do not. Activity Price becomes a source_activity_price
 * row (AED) — never merged into approval signals.
 */

import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { cleanText, normalizeName, parseAmount } from "../normalize";
import type {
  DiscoveredSource,
  FetchedPayload,
  OfficialActivitySourceAdapter,
  ParsedActivity,
} from "../types";

const SOURCE_URL = "https://rakez.com/en/start-a-business/license-activity-list";

const DEFAULT_LOCAL_FILE = path.join(
  process.cwd(),
  "data",
  "raw",
  "rakez",
  "2026-08-24",
  "rakez-activity-master.xlsx"
);

/** Column headers exactly as they appear in row 1 of the export. */
const HEADERS = {
  amNumber: "Activity Master: Activity Master Number",
  zone: "Zone",
  code: "Activity Code",
  nameEn: "Activity Name",
  nameAr: "Activity Name (Arabic)",
  status: "Status",
  minShareCapital: "Minimum Share Capital",
  licenceType: "License Type",
  esr: "Is Not Allowed for Coworking(ESR)",
  isSpecial: "Is Special",
  price: "Activity Price",
  group: "Activity Group",
  description: "Description",
  qualification: "Qualification Requirement",
  documentsRequired: "Documents Required",
};

/**
 * Government-entity tokens that distinguish genuine third-party approvals
 * from plain document or fee notes in the Documents Required column.
 */
const AUTHORITY_TOKEN_RE =
  /ministry|authority|municipality|department of|civil defense|civil aviation|chamber|council|embassy|notary|court|police|customs|command|telecom/i;

interface RakezRow {
  amNumber: string;
  zone: string;
  code: string;
  nameEn: string;
  nameAr: string;
  status: string;
  minShareCapital: string;
  licenceType: string;
  esr: string;
  isSpecial: string;
  price: string;
  group: string;
  description: string;
  qualification: string;
  documentsRequired: string;
}

function mapRow(raw: unknown[]): RakezRow | null {
  if (!Array.isArray(raw)) return null;
  const at = (i: number): string => String(raw[i] ?? "").trim();
  return {
    amNumber: at(0),
    zone: at(1),
    code: at(2),
    nameEn: at(3),
    nameAr: at(4),
    status: at(5),
    minShareCapital: at(6),
    licenceType: at(7),
    esr: at(8),
    isSpecial: at(9),
    price: at(10),
    group: at(11),
    description: at(12),
    qualification: at(13),
    documentsRequired: at(14),
  };
}

export const rakezAdapter: OfficialActivitySourceAdapter = {
  meta: {
    jurisdictionSlug: "rakez",
    jurisdictionName: "RAKEZ",
    emirate: "ras_al_khaimah",
    jurisdictionType: "free_zone",
    authorityName: "Ras Al Khaimah Economic Zone",
    authorityWebsite: "https://rakez.com/",
    sourceType: "free_zone_authority",
  },

  async discover(): Promise<DiscoveredSource[]> {
    return [
      {
        id: "rakez-activity-master",
        label: "RAKEZ Activity Master register (official XLSX export)",
        url: SOURCE_URL,
        format: "xlsx",
        notes:
          "Official register export shared by RAKEZ (3,615 activities across Freezone / Non-Freezone / Freelance Permit zones). Public site pagination is non-functional server-side; see adapter header for verification details.",
      },
    ];
  },

  async fetch(source: DiscoveredSource): Promise<FetchedPayload> {
    // The preserved canonical copy; RAKEZ_LOCAL_FILE allows pointing at any
    // refreshed export without code changes.
    const filePath = process.env.RAKEZ_LOCAL_FILE || DEFAULT_LOCAL_FILE;
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `RAKEZ activity master file not found: ${filePath} (set RAKEZ_LOCAL_FILE to the official export)`
      );
    }
    const body = fs.readFileSync(filePath);
    return {
      discovery: source,
      body,
      filename: "rakez-activity-master.xlsx",
      fetchedAt: new Date(),
      httpStatus: 200,
      finalUrl: source.url,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  },

  async parse(payload: FetchedPayload): Promise<ParsedActivity[]> {
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(payload.body as any);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error("RAKEZ XLSX has no worksheets");

    const rows: unknown[][] = [];
    sheet.eachRow((row) => {
      const rowData: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        rowData[colNumber - 1] = cell.value;
      });
      rows.push(rowData);
    });

    // Locate columns by header text so column order changes stay harmless.
    const headerRow = rows[0] ?? [];
    const idx = Object.fromEntries(
      Object.entries(HEADERS).map(([key, label]) => [
        key,
        headerRow.findIndex((h) => String(h ?? "").trim() === label),
      ])
    ) as Record<keyof typeof HEADERS, number>;

    const out: ParsedActivity[] = [];
    for (let i = 1; i < rows.length; i++) {
      const m = mapRow(rows[i]);
      if (!m) continue;
      if (!m.code && !m.nameEn) continue;
      if (idx.code >= 0) {
        // Re-map via located indices when headers matched; fall back to the
        // positional mapping otherwise.
        const r = rows[i];
        const val = (n: number): string => String(r[n] ?? "").trim();
        m.amNumber = idx.amNumber >= 0 ? val(idx.amNumber) : m.amNumber;
        m.zone = idx.zone >= 0 ? val(idx.zone) : m.zone;
        m.code = idx.code >= 0 ? val(idx.code) : m.code;
        m.nameEn = idx.nameEn >= 0 ? val(idx.nameEn) : m.nameEn;
        m.nameAr = idx.nameAr >= 0 ? val(idx.nameAr) : m.nameAr;
        m.status = idx.status >= 0 ? val(idx.status) : m.status;
        m.minShareCapital =
          idx.minShareCapital >= 0 ? val(idx.minShareCapital) : m.minShareCapital;
        m.licenceType =
          idx.licenceType >= 0 ? val(idx.licenceType) : m.licenceType;
        m.esr = idx.esr >= 0 ? val(idx.esr) : m.esr;
        m.isSpecial = idx.isSpecial >= 0 ? val(idx.isSpecial) : m.isSpecial;
        m.price = idx.price >= 0 ? val(idx.price) : m.price;
        m.group = idx.group >= 0 ? val(idx.group) : m.group;
        m.description =
          idx.description >= 0 ? val(idx.description) : m.description;
        m.qualification =
          idx.qualification >= 0 ? val(idx.qualification) : m.qualification;
        m.documentsRequired =
          idx.documentsRequired >= 0
            ? val(idx.documentsRequired)
            : m.documentsRequired;
      }
      if (!m.code && !m.nameEn) continue;

      const docs = cleanText(m.documentsRequired);
      const hasAuthority = !!docs && docs !== "-" && AUTHORITY_TOKEN_RE.test(docs);

      const prices = [];
      if (m.price) {
        const amount = parseAmount(m.price);
        if (amount !== null && amount !== undefined && !Number.isNaN(amount)) {
          prices.push({
            amount,
            currency: "AED",
            conditions: "Activity Price as published in official register",
          });
        }
      }

      out.push({
        raw: rows[i] as unknown as Record<string, unknown>,
        activityCode: m.code || undefined,
        officialName: m.nameEn,
        officialNameAr: m.nameAr || undefined,
        description: cleanText(m.description),
        activityGroup: cleanText(m.group),
        licenceLabel: m.licenceType || undefined,
        zone: m.zone || undefined,
        approval: hasAuthority
          ? {
              signal: "third_party_approval_indicated" as const,
              signalType: "third_party_approval_required" as const,
              notes: "Approving authority/entities named in Documents Required",
            }
          : {
              signal: "no_signal" as const,
              signalType: undefined,
              notes: docs && docs !== "-"
                ? "Documents Required lists no named government authority"
                : "No Documents Required entry in source",
            },
        prices,
        restrictions:
          m.esr === "ESR"
            ? "ESR flag set in source (Is Not Allowed for Coworking/ESR)"
            : undefined,
        extras: {
          amNumber: m.amNumber || undefined,
          sourceStatus: m.status || undefined,
          isSpecial: m.isSpecial || undefined,
          esrFlag: m.esr === "ESR" ? true : undefined,
          minimumShareCapital: m.minShareCapital || undefined,
          qualificationRequirement: cleanText(m.qualification) || undefined,
          documentsRequired: docs && docs !== "-" ? docs : undefined,
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
