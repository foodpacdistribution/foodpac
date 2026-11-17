import { getCurrentUser, PIPELINE } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { mayServeId } from "@/lib/rep-scope";
import { visitPhoto } from "@/lib/visit-log";

/** A photo taken on a store visit. Staff, and the salesperson who may work on that customer. */
export async function GET(_req: Request, ctx: RouteContext<"/api/visit-photos/[id]">) {
  const user = await getCurrentUser();
  if (!user || !PIPELINE.includes(user.role)) return new Response("Unauthorised", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const p = await visitPhoto(db, id);
  if (!p || !(await mayServeId(db, user, p.customerId))) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(p.data), {
    headers: { "Content-Type": p.mime, "Content-Length": String(p.bytes), "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
