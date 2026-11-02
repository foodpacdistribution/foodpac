import { getDb } from "@/lib/db";
import { listCatalog } from "@/lib/shop";

/** Search-as-you-type for the shop header. Public data only (no prices), so it can be cached briefly. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 60) ?? "";
  if (q.length < 2) return Response.json({ results: [] });
  const items = await listCatalog(await getDb(), null, { q, limit: 6 });
  return Response.json(
    { results: items.map((p) => ({ id: p.id, sku: p.sku, name: p.name, category: p.category, packSize: p.packSize, hasImage: p.hasImage, updatedAt: p.updatedAt })) },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
