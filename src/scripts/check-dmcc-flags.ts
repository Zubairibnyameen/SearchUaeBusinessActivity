import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join(process.cwd(), "data", "dmcc-activities.xlsx"));
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
const rows = data.slice(1);

console.log("Total rows:", rows.length);

// Check approval column values
const approvalValues = new Map<string, number>();
for (const row of rows) {
  const val = String(row["__EMPTY_14"] || "").trim().toUpperCase() || "(empty)";
  approvalValues.set(val, (approvalValues.get(val) || 0) + 1);
}
console.log("\nThird Party Approval Required column values:");
approvalValues.forEach((count, val) => console.log(`  "${val}": ${count}`));

// Show some examples
console.log("\nFirst 3 rows:");
rows.slice(0, 3).forEach((r, i) => {
  console.log(`  [${i+1}] Code: ${r["__EMPTY_5"]}, Name: ${r["__EMPTY_6"]}, Approval: "${r["__EMPTY_14"]}", Restrictions: "${r["__EMPTY_11"]}"`);
});
