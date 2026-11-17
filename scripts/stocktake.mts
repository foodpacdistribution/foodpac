// Applies a stocktake file (columns SKU and Count, e.g. "20ctn+7pk") to the DATABASE_URL database (or
// the local embedded one), exactly like Inventory → Stocktake in the back office: counts are converted
// with each product's pack size and goods sold but not yet delivered are taken off. Without --apply it
// only says what would change.
//
// Usage: DATABASE_URL=... node --conditions=react-server --import tsx scripts/stocktake.mts stocktake.csv [--apply]
import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { getDb } from "../src/lib/db";
import { stocktake } from "../src/lib/stocktake";

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node --conditions=react-server --import tsx scripts/stocktake.mts stocktake.csv [--apply]");
  process.exit(1);
}
const data = Papa.parse<Record<string, string>>(readFileSync(file, "utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: true }).data;
const lines = data.map((r) => ({ sku: r.SKU ?? "", count: r.Count ?? "" }));
const apply = flag === "--apply";
const { rows, changed } = await stocktake(await getDb(), lines, { apply, by: null });

for (const r of rows) {
  if (r.error) console.log(`  ✗ ${r.sku} "${r.count}": ${r.error}`);
  else if (r.newStock !== r.oldStock || r.dropped || r.short)
    console.log(
      `  ${r.sku.padEnd(22)} ${String(r.oldStock).padStart(6)} → ${String(r.newStock).padEnd(6)} (counted ${r.counted}${r.reserved ? `, ${r.reserved} for orders` : ""}${r.dropped ? `, ${r.dropped} loose packs left out` : ""}${r.short ? ", LESS THAN ORDERED" : ""})`,
    );
}
const errors = rows.filter((r) => r.error).length;
console.log(`${rows.length} lines · ${changed} products change · ${errors} can't be used`);
console.log(apply ? "Saved as stock counts." : "Dry run: nothing saved. Add --apply to update stock.");
process.exit(0);
