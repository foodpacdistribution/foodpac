import "server-only";
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import type { DB } from "./db";
import { goodsPhotos } from "./db/schema";

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
