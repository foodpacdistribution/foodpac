// Uploads a folder of product photos into the DATABASE_URL database (or the local embedded one),
// matched exactly like Products → Upload photos: each file is named after its product (code, old
// EMERGE code, or exact name). Without --apply it only says which files would match.
//
// Usage: DATABASE_URL=... node --conditions=react-server --import tsx scripts/upload-product-photos.mts <folder> [--apply]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import { products } from "../src/lib/db/schema";
import { codeFromFileName, saveProductPhotoByFileName } from "../src/lib/goods-photos";
import { MAX_PROOF_BYTES, sniffImage } from "../src/lib/proofs";

const [folder, flag] = process.argv.slice(2);
if (!folder) {
  console.error("Usage: node --conditions=react-server --import tsx scripts/upload-product-photos.mts <folder> [--apply]");
  process.exit(1);
}
const files = readdirSync(folder).filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && statSync(join(folder, f)).isFile());
const db = await getDb();

if (flag !== "--apply") {
  const codes = files.map(codeFromFileName);
  const found = new Set(codes.length ? (await db.select({ sku: products.sku }).from(products).where(inArray(products.sku, codes))).map((r) => r.sku) : []);
  const missing = files.filter((f) => !found.has(codeFromFileName(f)));
  console.log(`${files.length} photos · ${files.length - missing.length} match a product code · ${missing.length} don't (they may still match by product name)`);
  for (const f of missing.slice(0, 30)) console.log(`  ${f}`);
  console.log("Dry run: nothing saved. Add --apply to upload.");
} else {
  let saved = 0;
  const skipped: string[] = [];
  for (const f of files) {
    const data = new Uint8Array(readFileSync(join(folder, f)));
    const mime = sniffImage(data);
    if (!mime || data.byteLength > MAX_PROOF_BYTES) {
      skipped.push(`${f} (not a JPEG/PNG/WebP under 4 MB)`);
      continue;
    }
    const p = await saveProductPhotoByFileName(db, f, { data, mime });
    if (p) saved++;
    else skipped.push(`${f} (no product with this code or name)`);
  }
  console.log(`Uploaded ${saved} photos · ${skipped.length} skipped`);
  for (const s of skipped) console.log(`  ${s}`);
}
process.exit(0);
