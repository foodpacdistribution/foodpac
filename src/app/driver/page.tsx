import { and, asc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { deliveryEvents, deliveryProofs, orders, plans, routes, routeStops, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { customerEmailsOn } from "@/lib/delivery-emails";
import { depotFor, getDepots, getPlanView, getSettings } from "@/lib/planning";
import { nowSecondsIn, todayIn } from "@/lib/time";
import { DriverClient, type StopItem } from "./driver-client";

export const metadata: Metadata = { title: "My deliveries" };

export default async function DriverPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser(["driver"]);
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  // Every day from today on that has a route sent to this driver.
  const days = user.driverId
    ? await db
        .select({ date: plans.deliveryDate, stops: sql<number>`count(${routeStops.id})::int` })
        .from(routes)
        .innerJoin(plans, eq(plans.id, routes.planId))
        .leftJoin(routeStops, eq(routeStops.routeId, routes.id))
        .where(and(eq(routes.driverId, user.driverId), isNotNull(routes.dispatchedAt), gte(plans.deliveryDate, today)))
        .groupBy(plans.deliveryDate)
        .orderBy(asc(plans.deliveryDate))
        .limit(14)
    : [];
  // Any day: coming up, today, or a past one to look back at (and add a forgotten photo).
  const asked = (await searchParams).date;
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && !Number.isNaN(Date.parse(asked)) ? asked : today;
  const view = await getPlanView(db, date);
  // Drivers only ever receive their own route, and only once it has been dispatched.
  const route = view.routes.find((r) => r.driverId === user.driverId && r.dispatchedAt) ?? null;
  const orderIds = route?.stops.map((s) => s.orderId) ?? [];
  const doneIds = route?.stops.filter((s) => s.status !== "pending").map((s) => s.id) ?? [];
  const [depotList, lines, photoRows, goodsRows] = await Promise.all([
    getDepots(db),
    // What to hand over at each stop (shop and staff orders; other orders only have a unit count).
    orderIds.length
      ? db
          .select({ orderId: salesOrders.deliveryOrderId, item: salesOrderItems })
          .from(salesOrderItems)
          .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
          .where(and(inArray(salesOrders.deliveryOrderId, orderIds), ne(salesOrders.status, "cancelled")))
          .orderBy(asc(salesOrderItems.name))
      : [],
    // Photos on each finished stop's delivery record (saved at the same instant as the stop).
    doneIds.length
      ? db
          .select({ stopId: routeStops.id, n: sql<number>`count(${deliveryProofs.id})::int` })
          .from(routeStops)
          .innerJoin(deliveryEvents, and(eq(deliveryEvents.orderId, routeStops.orderId), eq(deliveryEvents.createdAt, routeStops.completedAt)))
          .innerJoin(deliveryProofs, and(eq(deliveryProofs.eventId, deliveryEvents.id), eq(deliveryProofs.kind, "photo")))
          .where(inArray(routeStops.id, doneIds))
          .groupBy(routeStops.id)
      : [],
    // The goods from each order's imported invoice or delivery order.
    orderIds.length ? db.select({ id: orders.id, goods: orders.goods }).from(orders).where(inArray(orders.id, orderIds)) : [],
  ]);
  const photos = Object.fromEntries(photoRows.map((r) => [r.stopId, r.n]));
  const depot = depotFor(depotList, route?.depotId);
  const items: Record<string, StopItem[]> = {};
  for (const { orderId, item } of lines) {
    if (!orderId) continue;
    // Like the pick list: what's still waiting for stock isn't on the van.
    (items[orderId] ??= []).push({ id: item.id, sku: item.sku, name: item.name, packSize: item.packSize, unit: item.unit, qty: item.qty - item.backorderQty, waiting: item.backorderQty });
  }
  // Orders without a shop or staff order: the goods listed on their invoice. Ticks are kept by
  // id, so each line's id is the order's plus its place on the invoice.
  for (const o of goodsRows) {
    if (items[o.id] || !o.goods?.length) continue;
    items[o.id] = o.goods.map((g, i) => ({ id: `${o.id}:${i}`, sku: "", name: g.name, packSize: "", unit: g.unit ?? "", qty: g.qty ?? 1, waiting: 0, noQty: g.qty === null }));
  }

  return (
    <DriverClient
      name={user.name.split(" ")[0]}
      linked={!!user.driverId}
      date={date}
      today={today}
      days={days}
      nowS={nowSecondsIn(s.timezone)}
      depot={depot}
      route={route}
      items={items}
      photos={photos}
      roles={user.roles}
      canTellCustomer={await customerEmailsOn(db)}
      requirePhoto={s.requirePhoto}
      requireSignature={s.requireSignature}
    />
  );
}
