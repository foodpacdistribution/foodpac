import { and, eq } from "drizzle-orm";
import { getCurrentUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { purchaseReturnPhotos } from "@/lib/db/schema";

/** A photo attached to a purchase return. Staff only. */
export async function GET(_req: Request, ctx: RouteContext<"/api/purchase-returns/[id]/photos/[photoId]">) {
  const user = await getCurrentUser();
  if (!user || !STAFF.includes(user.role)) return new Response("Unauthorised", { status: 401 });
  const { id, photoId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(photoId)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [p] = await db
    .select()
    .from(purchaseReturnPhotos)
    .where(and(eq(purchaseReturnPhotos.id, photoId), eq(purchaseReturnPhotos.purchaseReturnId, id)))
    .limit(1);
  if (!p) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(p.data), {
    headers: { "Content-Type": p.mime, "Content-Length": String(p.bytes), "Cache-Control": "private, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
