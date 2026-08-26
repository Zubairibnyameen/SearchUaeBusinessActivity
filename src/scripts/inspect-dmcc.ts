/**
 * Parse and inspect the DMCC activity list XLSX structure.
 */

import ExcelJS from "exceljs";
import path from "path";

const filePath = path.join(process.cwd(), "data", "dmcc-activities.xlsx");

async function main() {
  console.log("=== DMCC Activity List Inspector ===\n");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  console.log(`Sheet names: ${workbook.worksheets.map(s => s.name).join(", ")}\n`);

  for (const sheet of workbook.worksheets) {
    const headers: string[] = [];
    const data: Record<string, unknown>[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          headers[colNumber - 1] = String(cell.value ?? "");
        });
        return;
      }
      const obj: Record<string, unknown> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        obj[headers[colNumber - 1] ?? `__EMPTY_${colNumber - 1}`] = cell.value;
      });
      data.push(obj);
    });

    console.log(`--- Sheet: ${sheet.name} ---`);
    console.log(`Total rows: ${data.length}`);

    if (data.length > 0) {
      const firstRow = data[0];
      console.log(`Columns: ${Object.keys(firstRow).join(", ")}`);
      console.log(`\nFirst 3 rows:`);
      data.slice(0, 3).forEach((row, i) => {
        console.log(`  [${i + 1}]`, JSON.stringify(row, null, 2).split("\n").join("\n       "));
      });

      const codeColumn = Object.keys(firstRow).find(
        (k) =>
          k.toLowerCase().includes("code") ||
          k.toLowerCase().includes("activity code")
      );
      if (codeColumn) {
        const codes = data
          .map((r) => r[codeColumn])
          .filter(Boolean);
        console.log(`\nSample codes from "${codeColumn}":`);
        codes.slice(0, 10).forEach((c) => console.log(`  ${String(c)}`));
        console.log(`Total codes: ${codes.length}`);
      }

      const nameColumn = Object.keys(firstRow).find(
        (k) =>
          k.toLowerCase().includes("name") ||
          k.toLowerCase().includes("activity") ||
          k.toLowerCase().includes("description")
      );
      if (nameColumn) {
        console.log(`\nSample names from "${nameColumn}":`);
        data
          .slice(0, 5)
          .forEach((r) => console.log(`  ${String(r[nameColumn])}`));
      }
    }

    console.log("\n");
  }
}

main().catch(console.error);
