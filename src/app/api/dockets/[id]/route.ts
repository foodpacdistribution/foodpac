import { getCurrentUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { docketPhoto } from "@/lib/dockets";

/** A photographed invoice: for the office, and for the driver who took it. */
export async function GET(_req: Request, ctx: RouteContext<"/api/dockets/[id]">) {
  const user = await getCurrentUser();
  if (!user || !(STAFF.includes(user.role) || user.role === "driver")) return new Response("Unauthorised", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const p = await docketPhoto(await getDb(), id);
  if (!p || (user.role === "driver" && p.driverId !== user.driverId)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(p.data), {
    headers: { "Content-Type": p.mime, "Content-Length": String(p.data.byteLength), "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
