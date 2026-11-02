import { and, eq } from "drizzle-orm";
import { getCurrentUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { orders, routes, routeStops } from "@/lib/db/schema";
import { readProof } from "@/lib/proofs";

export async function GET(_req: Request, ctx: RouteContext<"/api/proofs/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorised", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const db = await getDb();
  const proof = await readProof(db, id);
  if (!proof) return new Response("Not found", { status: 404 });

  if (user.role === "customer") {
    // Customers may only see proofs for their own orders.
    const [own] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, proof.orderId), eq(orders.customerId, user.customerId ?? "")))
      .limit(1);
    if (!own) return new Response("Not found", { status: 404 });
  } else if (!STAFF.includes(user.role)) {
    // Drivers may only see proofs for orders that were on their own route.
    const [own] = await db
      .select({ id: routeStops.id })
      .from(routeStops)
      .innerJoin(routes, eq(routes.id, routeStops.routeId))
      .where(and(eq(routeStops.orderId, proof.orderId), eq(routes.driverId, user.driverId ?? "")))
      .limit(1);
    if (!own) return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(proof.data), {
    headers: {
      "Content-Type": proof.mime,
      "Content-Length": String(proof.bytes),
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
