import "server-only";
import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { DB } from "./db";
import { customers, orders, type PaymentMethod, products, routeStops, salesOrderItems, salesOrderNo, salesOrders } from "./db/schema";
import { shiftDate } from "./dates";
import { orderTotals } from "./order-totals";
import { UserError } from "./planning";
import { applyCreditToOrder, releaseOrderCredit } from "./credit";
import { createDeliveryOrder, dueIn } from "./shop";
import { fillWaiting, reserveStock, returnStock } from "./stock-allocation";

/** An order as staff type it in: for phone and email orders, or changes a customer asks for. */
export type StaffOrderInput = {
  customerId: string;
  deliveryDate: string;
  recipient: string;
  phone: string | null;
  address: string;
  instructions: string | null;
  windowStartMin: number | null;
  windowEndMin: number | null;
  notes: string | null;
  deliveryFeeCents: number;
  lines: { productId: string; qty: number; unitPriceCents: number }[];
};

export const STAFF_METHODS: PaymentMethod[] = ["invoice", "bank_transfer"];

function check(input: StaffOrderInput, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate) || Number.isNaN(Date.parse(input.deliveryDate))) throw new UserError("Choose a delivery date.");
  if (input.deliveryDate < today) throw new UserError("The delivery date can't be in the past.");
  if (!input.recipient.trim()) throw new UserError("Enter who will receive the delivery.");
  if (!input.address.trim()) throw new UserError("Enter the delivery address.");
  if (input.windowStartMin !== null && input.windowEndMin !== null && input.windowStartMin >= input.windowEndMin) throw new UserError("The delivery window must end after it starts.");
  if (!Number.isInteger(input.deliveryFeeCents) || input.deliveryFeeCents < 0) throw new UserError("The delivery fee must be $0 or more.");
  // One line per product: the same product twice is added together.
  const merged = new Map<string, { productId: string; qty: number; unitPriceCents: number }>();
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 0 || l.qty > 99999) throw new UserError("Quantities must be whole numbers.");
    if (!Number.isInteger(l.unitPriceCents) || l.unitPriceCents < 0) throw new UserError("Prices must be $0 or more.");
    if (l.qty === 0) continue;
    const m = merged.get(l.productId);
    merged.set(l.productId, m ? { ...m, qty: m.qty + l.qty } : { ...l });
  }
  if (!merged.size) throw new UserError("Add at least one product.");
  return [...merged.values()];
}

async function productsFor(tx: DB, ids: string[]) {
  const rows = await tx.select().from(products).where(inArray(products.id, ids));
  if (rows.length !== ids.length) throw new UserError("One of the products no longer exists. Reload the page and try again.");
  return new Map(rows.map((p) => [p.id, p]));
}

const snapshot = (p: typeof products.$inferSelect) => ({ sku: p.sku, name: p.name, packSize: p.packSize, unit: p.unit, gst: p.gst });

/** Places an order for a customer. It's confirmed straight away and goes to the planner; short lines wait for stock. */
export async function createStaffOrder(db: DB, staffId: string, input: StaffOrderInput & { method: PaymentMethod; idempotencyKey: string; creditCents?: number }, today: string) {
  const [existing] = await db.select().from(salesOrders).where(eq(salesOrders.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) return existing;
  const lines = check(input, today);
  if (!STAFF_METHODS.includes(input.method)) throw new UserError("Choose invoice or bank transfer.");
  const [customer] = await db.select().from(customers).where(eq(customers.id, input.customerId)).limit(1);
  if (!customer) throw new UserError("Choose a customer.");

  return db.transaction(async (t) => {
    const tx = t as unknown as DB;
    const byId = await productsFor(tx, lines.map((l) => l.productId));
    const items = [];
    for (const l of lines) {
      const { short } = await reserveStock(tx, l.productId, l.qty, { note: `New order · ${customer.name}`, by: staffId });
      items.push({ ...snapshot(byId.get(l.productId)!), productId: l.productId, qty: l.qty, unitPriceCents: l.unitPriceCents, lineCents: l.qty * l.unitPriceCents, backorderQty: short });
    }
    const totals = orderTotals(items, input.deliveryFeeCents);
    const [so] = await tx
      .insert(salesOrders)
      .values({
        number: sql`'FP-' || nextval('${sql.raw(salesOrderNo.seqName!)}')`,
        customerId: customer.id,
        userId: staffId,
        status: "confirmed",
        paymentStatus: "unpaid",
        paymentMethod: input.method,
        ...totals,
        deliveryDate: input.deliveryDate,
        recipient: input.recipient.trim(),
        phone: input.phone,
        address: input.address.trim(),
        instructions: input.instructions,
        windowStartMin: input.windowStartMin,
        windowEndMin: input.windowEndMin,
        notes: input.notes,
        dueDate: input.method === "invoice" ? shiftDate(input.deliveryDate, dueIn[customer.paymentTerms]) : null,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    await tx.insert(salesOrderItems).values(items.map((it) => ({ ...it, salesOrderId: so.id })));
    const deliveryOrderId = await createDeliveryOrder(tx, so, customer, items);
    // Store credit towards it, in the same transaction: not enough credit undoes the whole order.
    const creditAppliedCents = input.creditCents ? await applyCreditToOrder(tx, so.id, input.creditCents, staffId) : 0;
    return { ...so, deliveryOrderId, creditAppliedCents };
  });
}

/** Why an order can't be changed any more, or null if it can. */
export function editBlocker(so: Pick<typeof salesOrders.$inferSelect, "status" | "paymentMethod" | "fulfilment" | "invoiceStatus">, deliveryStatus: string | null) {
  if (so.status === "cancelled") return "This order is cancelled.";
  if (so.paymentMethod === "card") return "Card orders can't be changed after payment. Cancel it and enter a new order instead.";
  if (so.invoiceStatus === "final") return "The invoice is final, so this order can't be changed. Reopen it as a proforma first.";
  // A failed drop came back on the van, so it can be changed and sent again.
  if (so.fulfilment === "loaded" && deliveryStatus !== "failed") return "This order is already loaded on the van.";
  if (deliveryStatus === "dispatched" || deliveryStatus === "delivered") return "This order is already out for delivery or delivered.";
  return null;
}

/**
 * Changes an order's lines, prices and delivery details. Stock follows the change: more of a
 * product takes from the shelf (or waits), less gives back what was reserved, then waiting orders
 * get any stock that came free.
 */
export async function updateStaffOrder(db: DB, salesOrderId: string, input: Omit<StaffOrderInput, "customerId">, today: string) {
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, salesOrderId)).limit(1);
  if (!so) throw new UserError("Order not found.");
  const [delivery] = so.deliveryOrderId ? await db.select().from(orders).where(eq(orders.id, so.deliveryOrderId)).limit(1) : [];
  const blocked = editBlocker(so, delivery?.status ?? null);
  if (blocked) throw new UserError(blocked);
  // Keeping the date an order already had is fine even if that day has passed (e.g. a failed delivery being fixed).
  const lines = check({ ...input, customerId: so.customerId }, input.deliveryDate === so.deliveryDate ? input.deliveryDate : today);

  const result = await db.transaction(async (t) => {
    const tx = t as unknown as DB;
    const old = await tx.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id));
    const byId = await productsFor(tx, [...new Set([...lines.map((l) => l.productId), ...old.flatMap((o) => (o.productId ? [o.productId] : []))])]);
    const freed: string[] = [];
    const ref = { id: so.id, number: so.number, note: "Order changed" };
    const kept: { qty: number; unitPriceCents: number; gst: boolean }[] = [];

    // Lines that went or got smaller: waiting units go first, then reserved ones back on the shelf.
    for (const o of old) {
      const next = lines.find((l) => l.productId === o.productId);
      if (!o.productId || !next) {
        if (o.productId) {
          await returnStock(tx, o.productId, o.qty - o.backorderQty, ref);
          freed.push(o.productId);
        }
        await tx.delete(salesOrderItems).where(eq(salesOrderItems.id, o.id));
        continue;
      }
      let backorderQty = o.backorderQty;
      if (next.qty < o.qty) {
        const less = o.qty - next.qty;
        const fromWaiting = Math.min(backorderQty, less);
        backorderQty -= fromWaiting;
        await returnStock(tx, o.productId, less - fromWaiting, ref);
        if (less - fromWaiting > 0) freed.push(o.productId);
      } else if (next.qty > o.qty) {
        backorderQty += (await reserveStock(tx, o.productId, next.qty - o.qty, ref)).short;
      }
      await tx
        .update(salesOrderItems)
        .set({ qty: next.qty, unitPriceCents: next.unitPriceCents, lineCents: next.qty * next.unitPriceCents, backorderQty })
        .where(eq(salesOrderItems.id, o.id));
      kept.push({ qty: next.qty, unitPriceCents: next.unitPriceCents, gst: o.gst });
    }
    // New lines.
    for (const l of lines.filter((l) => !old.some((o) => o.productId === l.productId))) {
      const p = byId.get(l.productId)!;
      const { short } = await reserveStock(tx, l.productId, l.qty, ref);
      await tx.insert(salesOrderItems).values({ ...snapshot(p), salesOrderId: so.id, productId: l.productId, qty: l.qty, unitPriceCents: l.unitPriceCents, lineCents: l.qty * l.unitPriceCents, backorderQty: short });
      kept.push({ qty: l.qty, unitPriceCents: l.unitPriceCents, gst: p.gst });
    }

    const totals = orderTotals(kept, input.deliveryFeeCents);
    const dateChanged = input.deliveryDate !== so.deliveryDate;
    const [customer] = await tx.select({ paymentTerms: customers.paymentTerms }).from(customers).where(eq(customers.id, so.customerId)).limit(1);
    await tx
      .update(salesOrders)
      .set({
        ...totals,
        deliveryDate: input.deliveryDate,
        recipient: input.recipient.trim(),
        phone: input.phone,
        address: input.address.trim(),
        instructions: input.instructions,
        windowStartMin: input.windowStartMin,
        windowEndMin: input.windowEndMin,
        notes: input.notes,
        ...(dateChanged && so.paymentMethod === "invoice" && customer ? { dueDate: shiftDate(input.deliveryDate, dueIn[customer.paymentTerms]) } : {}),
        // Off the van again (new day, or a failed drop being sent again): back to packed in the warehouse.
        ...(so.fulfilment === "loaded" && (dateChanged || delivery?.status === "failed") ? { fulfilment: "packed" as const } : {}),
        // Paid entirely with store credit and now costs more: the difference is still to pay.
        ...(so.creditAppliedCents > 0 && so.creditAppliedCents >= so.totalCents && totals.totalCents > so.creditAppliedCents ? { paymentStatus: "unpaid" as const, paidAt: null } : {}),
      })
      .where(eq(salesOrders.id, so.id));
    // Now cheaper than the credit used on it: the extra credit goes back to the customer.
    if (so.creditAppliedCents > totals.totalCents) await releaseOrderCredit(tx, so, totals.totalCents, "Order reduced", null);

    // The delivery follows: new day or address takes it off any planned route until it's re-planned.
    let regeocode = false;
    if (delivery) {
      const addressChanged = delivery.address !== input.address.trim();
      if (dateChanged) await tx.delete(routeStops).where(and(eq(routeStops.orderId, delivery.id), eq(routeStops.status, "pending")));
      await tx
        .update(orders)
        .set({
          deliveryDate: input.deliveryDate,
          phone: input.phone,
          address: input.address.trim(),
          windowStartMin: input.windowStartMin,
          windowEndMin: input.windowEndMin,
          demand: Math.max(1, kept.reduce((n, l) => n + l.qty, 0)),
          notes: [input.recipient.trim() && `Deliver to ${input.recipient.trim()}`, input.instructions].filter(Boolean).join(" · ") || null,
          updatedAt: new Date(),
          ...(addressChanged ? { lat: null, lng: null, geocodeStatus: "pending" as const, geocodeLabel: null, suburb: null, postcode: null } : {}),
          ...(dateChanged || delivery.status === "failed" ? { status: "pending" as const, driverId: null } : {}),
        })
        .where(eq(orders.id, delivery.id));
      regeocode = addressChanged;
    }
    const filled = await fillWaiting(tx, freed);
    return { filled, regeocode, previousDate: so.deliveryDate };
  });
  return { ...result, deliveryOrderId: delivery?.id ?? null };
}

/** How far back a missed delivery day still counts as something to sort out. */
export const MISSED_LOOKBACK_DAYS = 60;

/**
 * Confirmed orders whose delivery day has passed without being delivered: never planned, never
 * sent, or the drop failed. Without this they drop off the open list two days later, unnoticed.
 */
export function missedDelivery(today: string) {
  return and(
    eq(salesOrders.status, "confirmed"),
    lt(salesOrders.deliveryDate, today),
    gte(salesOrders.deliveryDate, shiftDate(today, -MISSED_LOOKBACK_DAYS)),
    sql`not exists (select 1 from ${orders} d where d.id = ${salesOrders.deliveryOrderId} and d.status = 'delivered')`,
  );
}

/**
 * A delivery moved to another day takes its shop order along: same day, an invoice due date
 * counted from the new day (unless the invoice is already final), and goods that were on the van
 * are back in the warehouse as packed.
 */
export async function followDeliveryDate(db: DB, deliveryOrderId: string, date: string) {
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.deliveryOrderId, deliveryOrderId)).limit(1);
  if (!so || so.deliveryDate === date) return;
  const [customer] = await db.select({ paymentTerms: customers.paymentTerms }).from(customers).where(eq(customers.id, so.customerId)).limit(1);
  await db
    .update(salesOrders)
    .set({
      deliveryDate: date,
      ...(so.paymentMethod === "invoice" && so.invoiceStatus !== "final" && customer ? { dueDate: shiftDate(date, dueIn[customer.paymentTerms]) } : {}),
      ...(so.fulfilment === "loaded" ? { fulfilment: "packed" as const } : {}),
    })
    .where(eq(salesOrders.id, so.id));
}

/**
 * Moves shop orders to another delivery day, with their delivery: off any route that hasn't been
 * driven, back in the planner's queue. Delivered orders, and ones on a van out today, stay put.
 * Returns how many moved, why the others didn't, and new deliveries that still need locating.
 */
export async function moveSalesToDay(db: DB, ids: string[], date: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new UserError("Choose a delivery date.");
  if (date < today) throw new UserError("The delivery date can't be in the past.");
  const rows = await db
    .select({ so: salesOrders, delivery: orders, customer: customers })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .leftJoin(orders, eq(orders.id, salesOrders.deliveryOrderId))
    .where(inArray(salesOrders.id, ids.slice(0, 500)));
  let moved = 0;
  const skipped: string[] = [];
  const created: string[] = [];
  for (const { so, delivery, customer } of rows) {
    if (so.status !== "confirmed") {
      skipped.push(so.number);
      continue;
    }
    if (delivery?.status === "delivered") {
      skipped.push(so.number);
      continue;
    }
    // On a van that's out today: the driver still has it.
    if (delivery?.status === "dispatched" && delivery.deliveryDate >= today) {
      skipped.push(so.number);
      continue;
    }
    if (delivery && delivery.deliveryDate !== date) {
      const [clash] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.orderNumber, delivery.orderNumber), eq(orders.deliveryDate, date), ne(orders.id, delivery.id)))
        .limit(1);
      if (clash) {
        skipped.push(so.number);
        continue;
      }
    }
    await db.transaction(async (t) => {
      const tx = t as unknown as DB;
      if (delivery) {
        await tx.delete(routeStops).where(and(eq(routeStops.orderId, delivery.id), eq(routeStops.status, "pending")));
        await tx.update(orders).set({ deliveryDate: date, status: "pending", driverId: null, updatedAt: new Date() }).where(eq(orders.id, delivery.id));
        await followDeliveryDate(tx, delivery.id, date);
      } else {
        await tx
          .update(salesOrders)
          .set({
            deliveryDate: date,
            ...(so.paymentMethod === "invoice" && so.invoiceStatus !== "final" ? { dueDate: shiftDate(date, dueIn[customer.paymentTerms]) } : {}),
            ...(so.fulfilment === "loaded" ? { fulfilment: "packed" as const } : {}),
          })
          .where(eq(salesOrders.id, so.id));
        const id = await createDeliveryOrder(tx, { ...so, deliveryDate: date }, customer);
        if (id) created.push(id);
      }
    });
    moved++;
  }
  return { moved, skipped, created, previousDates: [...new Set(rows.map((r) => r.so.deliveryDate))] };
}
