// Imports a product spreadsheet (CSV) into the DATABASE_URL database (or the local embedded one),
// with exactly the checks and effects of Products → Import in the back office. Without --apply it
// only checks the file and says what would change.
//
// Usage: DATABASE_URL=... node --conditions=react-server --import tsx scripts/import-products.mts products.csv [--apply]
import { readFileSync } from "node:fs";
import { inArray } from "drizzle-orm";
import Papa from "papaparse";
import { getDb } from "../src/lib/db";
import { products } from "../src/lib/db/schema";
import { checkProductRow, duplicateSkus, guessProductMapping, PRODUCT_FIELDS, type ProductImportRow } from "../src/lib/product-import";
import { applyProductImport } from "../src/lib/product-import-apply";

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node --conditions=react-server --import tsx scripts/import-products.mts products.csv [--apply]");
  process.exit(1);
}
const parsed = Papa.parse<string[]>(readFileSync(file, "utf8").replace(/^﻿/, ""), { skipEmptyLines: true });
const [headers, ...lines] = parsed.data;
const mapping = guessProductMapping(headers);
const rows: ProductImportRow[] = lines.map((cells) =>
  Object.fromEntries(PRODUCT_FIELDS.flatMap((f) => (mapping[f.key] === undefined ? [] : [[f.key, cells[mapping[f.key]!] ?? ""]]))),
);
console.log(`Columns: ${PRODUCT_FIELDS.filter((f) => mapping[f.key] !== undefined).map((f) => `${f.key}←"${headers[mapping[f.key]!]}"`).join(", ")}`);

const db = await getDb();
if (flag !== "--apply") {
  const dupes = duplicateSkus(rows);
  const checked = rows.map((r) => checkProductRow(r, { pricesIncGst: false }));
  const bad = checked.flatMap((c, i) => (c.ok ? (dupes.has(i) ? [`row ${i + 2}: same SKU as row ${dupes.get(i)! + 2}`] : []) : [`row ${i + 2}: ${c.error}`]));
  const skus = checked.flatMap((c) => (c.ok ? [c.value.sku] : []));
  const existing = skus.length ? await db.select({ sku: products.sku }).from(products).where(inArray(products.sku, skus)) : [];
  console.log(`${rows.length} rows · ${bad.length} with problems · ${skus.length - existing.length} new · ${existing.length} already there (would be updated)`);
  for (const b of bad.slice(0, 20)) console.log(`  ${b}`);
  console.log("Dry run: nothing saved. Add --apply to import.");
} else {
  const r = await applyProductImport(db, rows, { pricesIncGst: false }, null);
  if (r.errors.length) {
    console.log(`Nothing saved: ${r.errors.length} rows with problems`);
    for (const e of r.errors.slice(0, 20)) console.log(`  row ${e.row}: ${e.message}`);
    process.exit(1);
  }
  console.log(`Imported: ${r.created} added · ${r.updated} updated · ${r.photos ?? 0} took the photo printed on an invoice`);
}
process.exit(0);
