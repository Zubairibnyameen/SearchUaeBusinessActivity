/**
 * Parse and inspect the DMCC activity list XLSX structure.
 */

import * as XLSX from "xlsx";
import path from "path";

const filePath = path.join(process.cwd(), "data", "dmcc-activities.xlsx");

console.log("=== DMCC Activity List Inspector ===\n");

const workbook = XLSX.readFile(filePath);
console.log(`Sheet names: ${workbook.SheetNames.join(", ")}\n`);

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);

  console.log(`--- Sheet: ${sheetName} ---`);
  console.log(`Total rows: ${data.length}`);

  if (data.length > 0) {
    const firstRow = data[0] as Record<string, unknown>;
    console.log(`Columns: ${Object.keys(firstRow).join(", ")}`);
    console.log(`\nFirst 3 rows:`);
    data.slice(0, 3).forEach((row, i) => {
      console.log(`  [${i + 1}]`, JSON.stringify(row, null, 2).split("\n").join("\n       "));
    });

    // Check for activity code patterns
    const codeColumn = Object.keys(firstRow).find(
      (k) =>
        k.toLowerCase().includes("code") ||
        k.toLowerCase().includes("activity code")
    );
    if (codeColumn) {
      const codes = data
        .map((r) => (r as Record<string, unknown>)[codeColumn])
        .filter(Boolean);
      console.log(`\nSample codes from "${codeColumn}":`);
      codes.slice(0, 10).forEach((c) => console.log(`  ${String(c)}`));
      console.log(`Total codes: ${codes.length}`);
    }

    // Check for activity name patterns
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
        .forEach((r) => console.log(`  ${String((r as Record<string, unknown>)[nameColumn])}`));
    }
  }

  console.log("\n");
}
