import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { goodsPhotos } from "@/lib/db/schema";

/** A product photo cut from an imported invoice, for staff and drivers. */
export async function GET(_req: Request, ctx: RouteContext<"/api/goods-photos/[id]">) {
  const user = await getCurrentUser();
  if (!user || user.role === "customer") return new Response("Unauthorised", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{64}$/.test(id)) return new Response("Not found", { status: 404 });
  const [p] = await (await getDb()).select({ mime: goodsPhotos.mime, data: goodsPhotos.data }).from(goodsPhotos).where(eq(goodsPhotos.id, id)).limit(1);
  if (!p) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(p.data), { headers: { "Content-Type": p.mime, "Cache-Control": "private, max-age=86400" } });
}
