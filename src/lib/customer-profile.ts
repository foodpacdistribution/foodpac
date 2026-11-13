import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { creditAccount, creditHistory } from "./credit";
import type { DB } from "./db";
import {
  customerAddresses,
  customerReturns,
  customers,
  deliveryEvents,
  deliveryProofs,
  drivers,
  orders,
  quotes,
  salesOrderItems,
  salesOrders,
  users,
} from "./db/schema";
import { goodsKey } from "./goods-photos";

/** How far back each list goes; older records stay in their own pages. */
const MAX_ROWS = 300;

export type TimelineEvent = {
  at: string;
  kind: "joined" | "order" | "paid" | "cancelled" | "delivered" | "failed" | "quote" | "quote_accepted" | "return" | "credit" | "portal";
  /** English template, translated on screen with `vars`. */
  title: string;
  vars?: Record<string, string>;
  detail?: string;
  href?: string;
};

/**
 * Everything about one customer for their page in the back office: details, account, sales,
 * deliveries (shop orders and imported invoices alike), quotes, returns, store credit, what they
 * buy most, and one timeline of all of it. `today` is the business's date (for overdue invoices).
 */
export async function customerProfile(db: DB, id: string, today: string) {
  const [c] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!c) return null;

  const [login, rep, addresses, sales, deliveries, quoteRows, returnRows, account, credit] = await Promise.all([
    db
      .select({ email: users.email, name: users.name, createdAt: users.createdAt })
      .from(users)
      .where(and(eq(users.customerId, id), eq(users.role, "customer")))
      .limit(1)
      .then((r) => r[0] ?? null),
    c.salesRepId ? db.select({ name: users.name }).from(users).where(eq(users.id, c.salesRepId)).limit(1).then((r) => r[0]?.name ?? null) : null,
    db.select().from(customerAddresses).where(eq(customerAddresses.customerId, id)),
    db
      .select({
        id: salesOrders.id,
        number: salesOrders.number,
        createdAt: salesOrders.createdAt,
        deliveryDate: salesOrders.deliveryDate,
        status: salesOrders.status,
        paymentStatus: salesOrders.paymentStatus,
        paymentMethod: salesOrders.paymentMethod,
        fulfilment: salesOrders.fulfilment,
        totalCents: salesOrders.totalCents,
        creditAppliedCents: salesOrders.creditAppliedCents,
        dueDate: salesOrders.dueDate,
        invoiceStatus: salesOrders.invoiceStatus,
        paidAt: salesOrders.paidAt,
        cancelledAt: salesOrders.cancelledAt,
        deliveryOrderId: salesOrders.deliveryOrderId,
      })
      .from(salesOrders)
      .where(eq(salesOrders.customerId, id))
      .orderBy(desc(salesOrders.createdAt))
      .limit(MAX_ROWS),
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        deliveryDate: orders.deliveryDate,
        status: orders.status,
        address: orders.address,
        goods: orders.goods,
        demand: orders.demand,
        driver: drivers.name,
      })
      .from(orders)
      .leftJoin(drivers, eq(drivers.id, orders.driverId))
      .where(eq(orders.customerId, id))
      .orderBy(desc(orders.deliveryDate))
      .limit(MAX_ROWS),
    db.select().from(quotes).where(eq(quotes.customerId, id)).orderBy(desc(quotes.createdAt)).limit(MAX_ROWS),
    db.select().from(customerReturns).where(eq(customerReturns.customerId, id)).orderBy(desc(customerReturns.createdAt)).limit(MAX_ROWS),
    creditAccount(db, id),
    creditHistory(db, id),
  ]);

  // How each delivery went: the latest outcome, and the first delivery photo.
  const deliveryIds = deliveries.map((d) => d.id);
  const [outcomes, photos] = deliveryIds.length
    ? await Promise.all([
        db
          .select({ orderId: deliveryEvents.orderId, type: deliveryEvents.type, reason: deliveryEvents.reason, recipient: deliveryEvents.recipient, at: deliveryEvents.createdAt })
          .from(deliveryEvents)
          .where(and(inArray(deliveryEvents.orderId, deliveryIds), ne(deliveryEvents.type, "route_started")))
          .orderBy(desc(deliveryEvents.createdAt)),
        db
          .select({ orderId: deliveryProofs.orderId, id: deliveryProofs.id })
          .from(deliveryProofs)
          .where(and(inArray(deliveryProofs.orderId, deliveryIds), eq(deliveryProofs.kind, "photo")))
          .orderBy(deliveryProofs.createdAt),
      ])
    : [[], []];
  const outcomeOf = new Map<string, (typeof outcomes)[number]>();
  for (const o of outcomes) if (!outcomeOf.has(o.orderId)) outcomeOf.set(o.orderId, o);
  const photoOf = new Map<string, string>();
  for (const p of photos) if (!photoOf.has(p.orderId)) photoOf.set(p.orderId, p.id);
  const shopOrderOf = new Map(sales.filter((s) => s.deliveryOrderId).map((s) => [s.deliveryOrderId!, s]));

  // What they buy: shop and staff orders' lines, plus the goods on imported invoices (deliveries
  // without a shop order), counted once per product name.
  const items = sales.length
    ? await db
        .select({ salesOrderId: salesOrderItems.salesOrderId, sku: salesOrderItems.sku, name: salesOrderItems.name, qty: salesOrderItems.qty })
        .from(salesOrderItems)
        .where(inArray(salesOrderItems.salesOrderId, sales.filter((s) => s.status !== "cancelled").map((s) => s.id)))
    : [];
  const when = new Map(sales.map((s) => [s.id, s.deliveryDate]));
  const bought = new Map<string, { name: string; sku: string | null; qty: number; orders: number; last: string }>();
  const add = (name: string, sku: string | null, qty: number, date: string) => {
    const k = goodsKey(name);
    const b = bought.get(k) ?? { name, sku, qty: 0, orders: 0, last: date };
    b.qty += qty;
    b.orders += 1;
    if (date > b.last) b.last = date;
    bought.set(k, b);
  };
  for (const it of items) add(it.name, it.sku, it.qty, when.get(it.salesOrderId) ?? "");
  for (const d of deliveries) if (!shopOrderOf.has(d.id)) for (const g of d.goods ?? []) add(g.name, null, g.qty ?? 0, d.deliveryDate);
  const topProducts = [...bought.values()].sort((a, b) => b.orders - a.orders || b.qty - a.qty).slice(0, 12);

  // The numbers at the top.
  const live = sales.filter((s) => s.status !== "cancelled");
  const due = (s: (typeof sales)[number]) => Math.max(0, s.totalCents - s.creditAppliedCents);
  const unpaid = live.filter((s) => s.paymentStatus === "unpaid");
  const since90 = Date.now() - 90 * 86_400_000;
  const delivered = deliveries.filter((d) => d.status === "delivered");
  const stats = {
    lifetimeCents: live.reduce((t, s) => t + s.totalCents, 0),
    last90Cents: live.filter((s) => s.createdAt.getTime() >= since90).reduce((t, s) => t + s.totalCents, 0),
    orders: live.length,
    avgOrderCents: live.length ? Math.round(live.reduce((t, s) => t + s.totalCents, 0) / live.length) : 0,
    unpaidCents: unpaid.reduce((t, s) => t + due(s), 0),
    overdueCents: unpaid.filter((s) => s.dueDate && s.dueDate < today).reduce((t, s) => t + due(s), 0),
    deliveries: deliveries.length,
    delivered: delivered.length,
    failed: deliveries.filter((d) => d.status === "failed").length,
    lastDelivery: delivered.map((d) => d.deliveryDate).sort().at(-1) ?? null,
    nextDelivery: deliveries.filter((d) => d.deliveryDate >= today && ["pending", "planned", "dispatched"].includes(d.status)).map((d) => d.deliveryDate).sort()[0] ?? null,
    lastOrder: live[0]?.createdAt.toISOString() ?? null,
  };

  // One timeline, newest first.
  const iso = (d: Date) => d.toISOString();
  const events: TimelineEvent[] = [{ at: iso(c.createdAt), kind: "joined", title: "Became a customer" }];
  if (login) events.push({ at: iso(login.createdAt), kind: "portal", title: "Portal login created", detail: login.email });
  for (const s of sales) {
    const href = `/admin/sales/${s.id}`;
    events.push({ at: iso(s.createdAt), kind: "order", title: "Order {number}", vars: { number: s.number }, detail: `$${(s.totalCents / 100).toFixed(2)} · delivery ${s.deliveryDate}`, href });
    if (s.paidAt) events.push({ at: iso(s.paidAt), kind: "paid", title: "Paid {number}", vars: { number: s.number }, detail: `$${(due(s) / 100).toFixed(2)}`, href });
    if (s.cancelledAt) events.push({ at: iso(s.cancelledAt), kind: "cancelled", title: "Cancelled {number}", vars: { number: s.number }, href });
  }
  for (const d of deliveries) {
    const o = outcomeOf.get(d.id);
    if (!o) continue;
    events.push({
      at: iso(o.at),
      kind: o.type === "delivered" ? "delivered" : "failed",
      title: o.type === "delivered" ? "Delivered: {number}" : "Delivery failed: {number}",
      vars: { number: d.orderNumber },
      detail: o.type === "delivered" ? [o.recipient, d.driver].filter(Boolean).join(" · ") || undefined : (o.reason ?? undefined),
    });
  }
  for (const q of quoteRows) {
    events.push({ at: iso(q.createdAt), kind: "quote", title: "Quote {number}", vars: { number: q.number }, detail: `$${(q.totalCents / 100).toFixed(2)}`, href: `/admin/quotes/${q.id}` });
    if (q.acceptedAt) events.push({ at: iso(q.acceptedAt), kind: "quote_accepted", title: "Quote {number} accepted", vars: { number: q.number }, href: `/admin/quotes/${q.id}` });
  }
  for (const r of returnRows) events.push({ at: iso(r.createdAt), kind: "return", title: "Return {number}", vars: { number: r.returnNumber }, detail: `$${Number(r.total).toFixed(2)}`, href: `/admin/customer-returns/${r.id}` });
  for (const t of credit) events.push({ at: iso(t.createdAt), kind: "credit", title: "Store credit {amount}", vars: { amount: `${Number(t.amount) >= 0 ? "+" : "−"}$${Math.abs(Number(t.amount)).toFixed(2)}` }, detail: t.description ?? t.sourceNumber ?? undefined });
  events.sort((a, b) => b.at.localeCompare(a.at));

  return {
    customer: c,
    login,
    rep,
    addresses,
    stats,
    account,
    credit,
    sales: sales.map((s) => ({ ...s, dueCents: due(s), overdue: s.status !== "cancelled" && s.paymentStatus === "unpaid" && !!s.dueDate && s.dueDate < today })),
    deliveries: deliveries.map((d) => ({
      ...d,
      lines: d.goods?.length ?? 0,
      outcome: outcomeOf.get(d.id) ?? null,
      photoId: photoOf.get(d.id) ?? null,
      shopOrder: shopOrderOf.get(d.id) ? { id: shopOrderOf.get(d.id)!.id, number: shopOrderOf.get(d.id)!.number } : null,
    })),
    quotes: quoteRows,
    returns: returnRows,
    topProducts,
    timeline: events.slice(0, 150),
  };
}

export type CustomerProfile = NonNullable<Awaited<ReturnType<typeof customerProfile>>>;
