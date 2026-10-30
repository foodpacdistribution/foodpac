import { and, asc, eq, inArray } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { deliveryEvents, drivers, orders, routeStops } from "@/lib/db/schema";
import type { ImportRow } from "@/lib/orders";
import { getSettings } from "@/lib/planning";
import { geocodeOrderIds, upsertOrders, verifyApiKey } from "@/lib/sync";
import { formatClock, todayIn } from "@/lib/time";

const unauthorised = () => Response.json({ error: "Missing or invalid API key" }, { status: 401 });

/**
 * POST /api/v1/orders — create or update orders (matched on orderNumber + deliveryDate).
 * Body: { "orders": [ { "orderNumber", "address", "suburb", "postcode", "customerName", "phone",
 *   "deliveryDate" (YYYY-MM-DD or DD/MM/YYYY, default today), "timeWindow" ("9am-12pm") or
 *   "windowStart"/"windowEnd", "serviceMin", "demand", "priority", "notes", "depot" (depot name) } ] }
 */
export async function POST(req: Request) {
  const db = await getDb();
  if (!(await verifyApiKey(db, req))) return unauthorised();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const list = Array.isArray(body) ? body : (body as { orders?: unknown })?.orders;
  if (!Array.isArray(list) || list.length === 0) return Response.json({ error: 'Send { "orders": [...] }' }, { status: 400 });
  if (list.length > 1000) return Response.json({ error: "At most 1000 orders per request" }, { status: 413 });

  // Accept numbers/booleans as well as strings; validation is shared with spreadsheet import.
  const rows: ImportRow[] = list.map((o) =>
    Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])),
  );
  const s = await getSettings(db);
  const r = await upsertOrders(db, rows, { defaultDate: todayIn(s.timezone), source: "api" });
  // Locate new addresses after responding, so the caller isn't kept waiting on the geocoder.
  if (r.geocodeIds.length) after(() => geocodeOrderIds(db, r.geocodeIds));
  return Response.json(
    { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, locked: r.locked, errors: r.errors },
    { status: r.errors.length && !r.inserted && !r.updated ? 422 : 200 },
  );
}

/** GET /api/v1/orders?date=YYYY-MM-DD — delivery status for each order on that date. */
export async function GET(req: Request) {
  const db = await getDb();
  if (!(await verifyApiKey(db, req))) return unauthorised();
  const s = await getSettings(db);
  const date = new URL(req.url).searchParams.get("date") ?? todayIn(s.timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const rows = await db
    .select({ o: orders, driver: drivers.name })
    .from(orders)
    .leftJoin(drivers, eq(drivers.id, orders.driverId))
    .where(eq(orders.deliveryDate, date))
    .orderBy(asc(orders.orderNumber));
  const ids = rows.map((r) => r.o.id);
  const stops = ids.length ? await db.select().from(routeStops).where(inArray(routeStops.orderId, ids)) : [];
  const events = ids.length
    ? await db
        .select()
        .from(deliveryEvents)
        .where(and(inArray(deliveryEvents.orderId, ids), inArray(deliveryEvents.type, ["delivered", "failed"])))
    : [];

  return Response.json({
    date,
    orders: rows.map(({ o, driver }) => {
      const stop = stops.filter((x) => x.orderId === o.id).at(-1);
      const ev = events.filter((e) => e.orderId === o.id).at(-1);
      return {
        orderNumber: o.orderNumber,
        status: o.status,
        addressStatus: o.geocodeStatus,
        driver: ["dispatched", "delivered", "failed"].includes(o.status) ? driver : null,
        eta: stop && o.status === "dispatched" ? formatClock(stop.etaS) : null,
        completedAt: stop?.completedAt?.toISOString() ?? null,
        recipient: ev?.recipient ?? null,
        failureReason: ev?.type === "failed" ? ev.reason : null,
      };
    }),
  });
}
