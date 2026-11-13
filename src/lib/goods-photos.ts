import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "./db";
import { goodsPhotos, products } from "./db/schema";

/** The same product written slightly differently (case, spaces) is one photo. */
export const goodsKey = (name: string) => name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export const goodsPhotoId = (name: string) => createHash("sha256").update(goodsKey(name)).digest("hex");

/** Largest photo kept (they're thumbnails, cut from the invoice). */
export const MAX_GOODS_PHOTO_BYTES = 300 * 1024;

/** Photo URLs for these product names (name → URL), for the ones there is a photo of. */
export async function goodsPhotoUrls(db: DB, names: string[]): Promise<Map<string, string>> {
  const ids = new Map(names.map((n) => [n, goodsPhotoId(n)]));
  if (!ids.size) return new Map();
  const have = new Set((await db.select({ id: goodsPhotos.id }).from(goodsPhotos).where(inArray(goodsPhotos.id, [...new Set(ids.values())]))).map((r) => r.id));
  return new Map([...ids].filter(([, id]) => have.has(id)).map(([n, id]) => [n, `/api/goods-photos/${id}`]));
}

/**
 * Products without a photo of their own get the one cut from an invoice for the same product
 * name (EMERGE prints each product's photo on its invoices). Run after products are imported
 * and after new invoice photos are saved. A photo someone uploads later replaces it. Returns how
 * many products got one.
 */
export async function fillProductPhotosFromInvoices(db: DB): Promise<number> {
  const bare = await db.select({ id: products.id, name: products.name }).from(products).where(isNull(products.image));
  if (!bare.length) return 0;
  let filled = 0;
  for (let i = 0; i < bare.length; i += 200) {
    const chunk = bare.slice(i, i + 200).map((p) => ({ ...p, photo: goodsPhotoId(p.name) }));
    const photos = await db.select().from(goodsPhotos).where(inArray(goodsPhotos.id, [...new Set(chunk.map((p) => p.photo))]));
    const byId = new Map(photos.map((p) => [p.id, p]));
    for (const p of chunk) {
      const photo = byId.get(p.photo);
      if (!photo) continue;
      // Only if it still has none: a photo uploaded meanwhile wins.
      const [row] = await db
        .update(products)
        .set({ image: photo.data, imageMime: photo.mime, updatedAt: new Date() })
        .where(and(eq(products.id, p.id), isNull(products.image)))
        .returning({ id: products.id });
      if (row) filled++;
    }
  }
  return filled;
}

/** A product code written in a file name: "RB-BAPAW1/2B" and "rb bapaw1 2b.jpg" both find RB-BAPAW1-2B. */
export function codeFromFileName(fileName: string) {
  return fileName
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}
