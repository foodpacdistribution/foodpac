import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { products } from "@/lib/db/schema";

/** Product photos are public (shown in the shop). */
export async function GET(_req: Request, ctx: RouteContext<"/api/products/[id]/image">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [p] = await db
    .select({ image: products.image, mime: products.imageMime })
    .from(products)
    .where(and(eq(products.id, id)))
    .limit(1);
  if (!p?.image || !p.mime) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(p.image), {
    headers: { "Content-Type": p.mime, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
