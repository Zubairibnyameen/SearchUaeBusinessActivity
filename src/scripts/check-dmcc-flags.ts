import ExcelJS from "exceljs";
import path from "path";

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(process.cwd(), "data", "dmcc-activities.xlsx"));
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("No worksheet found");

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

  const rows = data.slice(1);

  console.log("Total rows:", rows.length);

  const approvalValues = new Map<string, number>();
  for (const row of rows) {
    const val = String(row["__EMPTY_14"] || "").trim().toUpperCase() || "(empty)";
    approvalValues.set(val, (approvalValues.get(val) || 0) + 1);
  }
  console.log("\nThird Party Approval Required column values:");
  approvalValues.forEach((count, val) => console.log(`  "${val}": ${count}`));

  console.log("\nFirst 3 rows:");
  rows.slice(0, 3).forEach((r, i) => {
    console.log(`  [${i+1}] Code: ${r["__EMPTY_5"]}, Name: ${r["__EMPTY_6"]}, Approval: "${r["__EMPTY_14"]}", Restrictions: "${r["__EMPTY_11"]}"`);
  });
}

main().catch(console.error);
