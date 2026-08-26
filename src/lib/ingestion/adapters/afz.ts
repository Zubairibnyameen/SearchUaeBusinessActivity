/**
 * AFZ (Ajman Free Zone) adapter — official business activities list.
 *
 * Primary source: https://afz.gov.ae/activity-list/
 *   Server-rendered HTML table #activitiesTable (DataTables runs client-side
 *   only, no AJAX) — 1,689 rows: Activity Number (AM-XXXXX), ISIC Code,
 *   License Type, Activity Name, Description.
 *
 * Rejected higher-priority candidate: Ajman Government Open Data portal
 *   dataset "ajman-free-zone-activities-master" (data.ajman.ae). It is a
 *   company-license snapshot (license_state_date, company_status incl.
 *   Suspended) with NO activity codes — unusable for a code-keyed activity
 *   catalog and would break uniqueness guarantees.
 */

import { fetchOfficial } from "../http";
import { cleanText, normalizeName } from "../normalize";
import type {
  DiscoveredSource,
  FetchedPayload,
  OfficialActivitySourceAdapter,
  ParsedActivity,
} from "../types";

const SOURCE_URL = "https://afz.gov.ae/activity-list/";

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#0?39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));
}

function cellToText(cellHtml: string): string {
  return cleanText(decodeEntities(cellHtml.replace(/<[^>]*>/g, " "))) ?? "";
}

export const afzAdapter: OfficialActivitySourceAdapter = {
  meta: {
    jurisdictionSlug: "afz",
    jurisdictionName: "Ajman Free Zone",
    emirate: "ajman",
    jurisdictionType: "free_zone",
    authorityName: "Ajman Free Zone",
    authorityWebsite: "https://www.afz.gov.ae/",
    sourceType: "free_zone_authority",
  },

  async discover(): Promise<DiscoveredSource[]> {
    return [
      {
        id: "afz-activity-list",
        label: "AFZ Business Activities List (official website table)",
        url: SOURCE_URL,
        format: "html",
        notes:
          "Server-rendered #activitiesTable; DataTables is client-side only so all rows are in the initial HTML. Open Data portal dataset rejected (company-license snapshots, no activity codes).",
      },
    ];
  },

  async fetch(source: DiscoveredSource): Promise<FetchedPayload> {
    // Offline fallback to a previously saved copy of the official page.
    if (process.env.AFZ_LOCAL_FILE) {
      const fs = await import("fs");
      const body = fs.readFileSync(process.env.AFZ_LOCAL_FILE);
      return {
        discovery: source,
        body,
        filename: "afz-activity-list.html",
        fetchedAt: new Date(),
        httpStatus: 200,
        finalUrl: source.url,
        contentType: "text/html",
      };
    }
    return fetchOfficial(source);
  },

  async parse(payload: FetchedPayload): Promise<ParsedActivity[]> {
    const html = payload.body.toString("utf8");

    const tableStart = html.indexOf('<table id="activitiesTable"');
    if (tableStart === -1) {
      throw new Error("#activitiesTable not found in AFZ page HTML");
    }
    const tableEnd = html.indexOf("</table>", tableStart);
    const tbodyStart = html.indexOf("<tbody>", tableStart);
    if (tbodyStart === -1 || tableEnd === -1) {
      throw new Error("AFZ activities table has no <tbody>");
    }
    const tbody = html.slice(tbodyStart, tableEnd);

    const out: ParsedActivity[] = [];
    const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
    let row: RegExpExecArray | null;

    while ((row = rowRe.exec(tbody)) !== null) {
      const cells: string[] = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let cell: RegExpExecArray | null;
      while ((cell = cellRe.exec(row[1])) !== null) {
        cells.push(cellToText(cell[1]));
      }

      // Expected columns: Activity Number | ISIC Code | License Type |
      //                   Activity Name | Description
      if (cells.length < 5) continue;
      const [codeCell, isicCell, licenceLabel, nameCell, descCell] = cells;

      // Only accept genuine activity rows (AM-\d+ codes).
      if (!/^AM-\d+/i.test(codeCell) || !nameCell) continue;

      out.push({
        raw: {
          activityNumber: codeCell,
          isicCode: isicCell,
          licenseType: licenceLabel,
          activityName: nameCell,
          description: descCell,
        },
        activityCode: codeCell,
        isicCode: isicCell || undefined,
        officialName: nameCell,
        description: descCell || undefined,
        licenceLabel: licenceLabel || undefined,
        approval: {
          signal: "no_signal",
          notes:
            "AFZ activity list publishes no third-party approval indicator for this activity",
        },
        extras: {
          sourceLicenceType: licenceLabel || undefined,
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
      description: a.description,
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
