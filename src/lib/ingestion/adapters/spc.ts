/**
 * SPC Free Zone adapter — official WordPress REST activities API.
 *
 * Source: https://www.spcfz.ae/wp-json/spc/v1/activities
 * (endpoint published by the site's own activity table via window.FTABLE_CONFIG)
 *
 * The API returns the full dataset (≈2,038 rows) in one response. Rows repeat
 * per price category ("Standard", "Publishing", "Electronic Publishing"), so
 * SubCodes are NOT unique across rows. parse() merges rows by SubCode into a
 * single canonical activity and preserves every category fee as its own
 * source_activity_price record.
 *
 * Field notes (verified against live data):
 *  - Description_EN = "{code} - Name" but the prefix code can differ from the
 *    row's own SubCode → strip any leading "N.N.N - " token generically.
 *  - Authority = third-party authority name or "N/A" (~430 rows named).
 *  - when = approval timing hint ("PRE"/"POST") or "N/A".
 *  - dnfbp = "DNFBP" for 30 rows (AML-classified activities).
 *  - Fee > 0 on every row; no separate description column except `notes`.
 */

import { fetchOfficial } from "../http";
import { cleanText, normalizeName } from "../normalize";
import type {
  DiscoveredSource,
  FetchedPayload,
  OfficialActivitySourceAdapter,
  OfficialPriceData,
  ParsedActivity,
} from "../types";

const SOURCE_URL = "https://www.spcfz.ae/wp-json/spc/v1/activities";

interface SpcRow {
  Category?: string;
  Code?: string;
  SubCode?: string;
  Description_EN?: string;
  Description_AR?: string;
  Authority?: string;
  Status?: string;
  dnfbp?: string;
  when?: string;
  notes?: string;
  Fee?: number | string;
  Zoho_ID?: string;
  Zoho_Category?: string;
  Zoho_Group?: string;
}

const NA = new Set(["", "n/a", "na", "-"]);

function isSet(v: string | undefined): boolean {
  return !!v && !NA.has(v.trim().toLowerCase());
}

function stripName(raw: string): string {
  // Remove a leading ISIC-style code prefix like "0160.00 - " or "5930.00- ".
  return cleanText(raw.replace(/^\d+(?:\.\d+)*\s*-\s*/, "")) ?? "";
}

function toFee(r: SpcRow): number {
  const n = Number(r.Fee);
  return Number.isFinite(n) ? n : 0;
}

export const spcAdapter: OfficialActivitySourceAdapter = {
  meta: {
    jurisdictionSlug: "spc",
    jurisdictionName: "SPC Free Zone",
    emirate: "sharjah",
    jurisdictionType: "free_zone",
    authorityName: "Sharjah Publishing City Free Zone",
    authorityWebsite: "https://www.spcfz.ae/",
    sourceType: "free_zone_authority",
  },

  async discover(): Promise<DiscoveredSource[]> {
    return [
      {
        id: "spc-activities-api",
        label: "SPC Free Zone official business activities API",
        url: SOURCE_URL,
        format: "json",
        notes:
          "WordPress REST endpoint exposed by the site's activity table (window.FTABLE_CONFIG). Full dataset in one response; rows repeat per price category — merged by SubCode, per-category fees kept as separate source_activity_price records.",
      },
    ];
  },

  async fetch(source: DiscoveredSource): Promise<FetchedPayload> {
    if (process.env.SPC_LOCAL_FILE) {
      const fs = await import("fs");
      const body = fs.readFileSync(process.env.SPC_LOCAL_FILE);
      return {
        discovery: source,
        body,
        filename: "spc-activities.json",
        fetchedAt: new Date(),
        httpStatus: 200,
        finalUrl: source.url,
        contentType: "application/json",
      };
    }
    return fetchOfficial(source);
  },

  async parse(payload: FetchedPayload): Promise<ParsedActivity[]> {
    const text = payload.body.toString("utf8").replace(/^\uFEFF/, "");
    let rows: SpcRow[];
    try {
      rows = JSON.parse(text);
    } catch {
      throw new Error("SPC API response is not valid JSON");
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("SPC API returned an empty dataset");
    }

    // ---- Group rows by SubCode (activity identity within SPC).
    const groups = new Map<string, SpcRow[]>();
    for (const r of rows) {
      const code = String(r.SubCode ?? "").trim();
      if (!code || !String(r.Description_EN ?? "").trim()) continue;
      const arr = groups.get(code);
      if (arr) arr.push(r);
      else groups.set(code, [r]);
    }

    // Deterministic ordering of codes and rows.
    const sortedCodes = [...groups.keys()].sort();

    const out: ParsedActivity[] = [];
    for (const code of sortedCodes) {
      const groupRows = groups.get(code)!;
      groupRows.sort((a, b) =>
        String(a.Category ?? "").localeCompare(String(b.Category ?? ""))
      );

      // Representative row: prefer "Standard" price category, else first row.
      const rep =
        groupRows.find(
          (r) => String(r.Category ?? "").toLowerCase() === "standard"
        ) ?? groupRows[0];

      // Distinct factual values across the group's rows.
      const categories = [
        ...new Set(
          groupRows
            .map((r) => cleanText(String(r.Category ?? "")))
            .filter(Boolean)
        ),
      ];
      const authorities = [
        ...new Set(
          groupRows
            .map((r) => cleanText(String(r.Authority ?? "")))
            .filter((v) => isSet(v))
        ),
      ];
      const timings = [
        ...new Set(
          groupRows
            .map((r) => (cleanText(String(r.when ?? "")) ?? "").toUpperCase())
            .filter((v) => isSet(v.toLowerCase()))
        ),
      ];
      const isDnfbp = groupRows.some(
        (r) => String(r.dnfbp ?? "").trim().toUpperCase() === "DNFBP"
      );
      const note = cleanText(
        groupRows.map((r) => String(r.notes ?? "")).find((n) => !!n) ?? ""
      );

      const officialName = stripName(String(rep.Description_EN ?? ""));
      const officialNameAr = cleanText(String(rep.Description_AR ?? ""));

      // Approval signal — a source indication, never a verified approval.
      let approval: ParsedActivity["approval"];
      if (authorities.length > 0) {
        approval = {
          signal: "third_party_approval_indicated",
          signalType: "third_party_authority_indicated",
          authorityName: authorities.join("; "),
          notes: timings.length
            ? `Approval timing marked by source: ${timings.join("/")}`
            : undefined,
        };
      } else {
        approval = {
          signal: "no_signal",
          notes: timings.length
            ? `Source marks approval timing (${timings.join("/")}) without naming an authority`
            : undefined,
        };
      }

      // Prices: one record per price-category fee (never merged into fees tables).
      const seenPrice = new Set<string>();
      const prices: OfficialPriceData[] = [];
      for (const r of groupRows) {
        const amount = toFee(r);
        if (!(amount > 0)) continue;
        const conditions = `SPC price category: ${
          cleanText(String(r.Category ?? "")) || "unspecified"
        }`;
        const key = `${amount}|${conditions}`;
        if (seenPrice.has(key)) continue;
        seenPrice.add(key);
        prices.push({ amount, currency: "AED", conditions });
      }
      const repAmount = toFee(rep);
      const primaryPrice: OfficialPriceData | undefined = prices.find(
        (p) => p.amount === repAmount && p.conditions === `SPC price category: ${cleanText(String(rep.Category ?? "")) || "unspecified"}`
      ) ?? prices[0];

      out.push({
        raw: { rows: groupRows },
        activityCode: code,
        officialName,
        officialNameAr: officialNameAr || undefined,
        description: note || undefined,
        officialCategory: cleanText(String(rep.Zoho_Category ?? "")),
        activityGroup: cleanText(String(rep.Code ?? "")),
        approval,
        price: primaryPrice,
        prices,
        restrictions: isDnfbp
          ? "DNFBP classification applies per SPC source"
          : undefined,
        extras: {
          zohoId: cleanText(String(rep.Zoho_ID ?? "")),
          zohoGroup: cleanText(String(rep.Zoho_Group ?? "")),
          status: cleanText(String(rep.Status ?? "")),
          spcCategories: categories,
          approvalTiming: timings,
          dnfbp: isDnfbp,
          sourceRowCount: groupRows.length,
          rawNotes: note || undefined,
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
