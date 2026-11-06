import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db";
import { goodsReceipts, products, purchaseOrderItems, purchaseOrderNo, purchaseOrders, type PurchaseOrderStatus, supplierPayments, suppliers } from "../db/schema";
import { UserError } from "../planning";
import { guarded, nextNumber } from "./common";
import { lineTotal, purchaseTotals, toCents } from "./labels";

export type SupplierInput = {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  abn: string | null;
  notes: string | null;
  active: boolean;
};

export async function saveSupplier(db: DB, id: string | null, input: SupplierInput) {
  if (!input.name.trim()) throw new UserError("Enter the supplier's name.");
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new UserError("That email address doesn't look right.");
  const values = { ...input, name: input.name.trim() };
  if (id) {
    const [row] = await db.update(suppliers).set(values).where(eq(suppliers.id, id)).returning();
    if (!row) throw new UserError("Supplier not found.");
    return row;
  }
  return (await db.insert(suppliers).values(values).returning())[0];
}

export type PurchaseOrderInput = {
  supplierId: string;
  orderDate: string;
  expectedDate: string | null;
  supplierReference: string | null;
  notes: string | null;
  lines: { productId: string; qty: number; unitCost: number }[];
};

/** Lines and prices can change until goods start arriving. */
export function poEditBlocker(po: { status: PurchaseOrderStatus }, receipts: number) {
  if (po.status === "cancelled") return "This purchase order is cancelled.";
  if (po.status === "received" || po.status === "closed" || po.status === "partially_received" || receipts > 0)
    return "Goods have been booked in against this purchase order, so it can't be changed.";
  return null;
}

async function receiptCount(db: DB, poId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId, poId));
  return n;
}

async function buildLines(db: DB, lines: PurchaseOrderInput["lines"]) {
  // The same product twice becomes one line.
  const merged = new Map<string, { productId: string; qty: number; unitCost: number }>();
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty < 0) throw new UserError("Quantities must be whole numbers.");
    if (!Number.isFinite(l.unitCost) || l.unitCost < 0) throw new UserError("Unit costs must be $0 or more.");
    if (!l.qty) continue;
    const m = merged.get(l.productId);
    merged.set(l.productId, m ? { ...m, qty: m.qty + l.qty } : { ...l });
  }
  if (!merged.size) throw new UserError("Add at least one product.");
  const rows = await db.select().from(products).where(inArray(products.id, [...merged.keys()]));
  if (rows.length !== merged.size) throw new UserError("One of the products no longer exists. Reload the page and try again.");
  const byId = new Map(rows.map((p) => [p.id, p]));
  return [...merged.values()].map((l) => {
    const p = byId.get(l.productId)!;
    return { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, orderedQty: l.qty, unitCost: l.unitCost, gst: p.gst, lineTotal: lineTotal(l.qty, l.unitCost) };
  });
}

function checkHeader(input: PurchaseOrderInput) {
  if (input.expectedDate && input.expectedDate < input.orderDate) throw new UserError("The expected delivery can't be before the order date.");
}

/** A new purchase order, as a draft. */
export async function createPurchaseOrder(db: DB, userId: string, input: PurchaseOrderInput) {
  checkHeader(input);
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1);
  if (!supplier) throw new UserError("Choose a supplier.");
  if (!supplier.active) throw new UserError("This supplier is marked inactive.");
  const lines = await buildLines(db, input.lines);
  return db.transaction(async (tx) => {
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        poNumber: nextNumber("PO-", purchaseOrderNo.seqName!),
        supplierId: supplier.id,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate,
        supplierReference: input.supplierReference,
        notes: input.notes,
        ...purchaseTotals(lines),
        createdBy: userId,
      })
      .returning();
    await tx.insert(purchaseOrderItems).values(lines.map((l) => ({ ...l, purchaseOrderId: po.id })));
    return po;
  });
}

export async function updatePurchaseOrder(db: DB, id: string, input: PurchaseOrderInput) {
  checkHeader(input);
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
  if (!po) throw new UserError("Purchase order not found.");
  const blocked = poEditBlocker(po, await receiptCount(db, id));
  if (blocked) throw new UserError(blocked);
  const lines = await buildLines(db, input.lines);
  await db.transaction(async (tx) => {
    await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
    await tx.insert(purchaseOrderItems).values(lines.map((l) => ({ ...l, purchaseOrderId: id })));
    await tx
      .update(purchaseOrders)
      .set({
        // Changing who it's from only makes sense before the supplier has it.
        ...(po.status === "draft" ? { supplierId: input.supplierId } : {}),
        orderDate: input.orderDate,
        expectedDate: input.expectedDate,
        supplierReference: input.supplierReference,
        notes: input.notes,
        ...purchaseTotals(lines),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));
  });
}

const TRANSITIONS: Record<"send" | "confirm" | "cancel" | "close", { from: PurchaseOrderStatus[]; to: PurchaseOrderStatus }> = {
  send: { from: ["draft"], to: "sent" },
  // Some suppliers confirm on the phone before we've emailed anything.
  confirm: { from: ["draft", "sent"], to: "confirmed" },
  cancel: { from: ["draft", "sent", "confirmed"], to: "cancelled" },
  // Part delivered and the rest isn't coming.
  close: { from: ["partially_received"], to: "closed" },
};

export async function setPurchaseOrderStatus(db: DB, id: string, action: keyof typeof TRANSITIONS) {
  const t = TRANSITIONS[action];
  if (!t) throw new UserError("Unknown action.");
  return guarded(() =>
    db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update");
      if (!po) throw new UserError("Purchase order not found.");
      if (!t.from.includes(po.status)) throw new UserError("This purchase order can't be changed that way any more. Reload the page.");
      if (action === "cancel") {
        if (await receiptCount(tx as unknown as DB, id)) throw new UserError("Goods have been booked in against this purchase order. Close it instead.");
        const [{ paid }] = await tx.select({ paid: sql<number>`coalesce(sum(${supplierPayments.amount}), 0)::float8` }).from(supplierPayments).where(eq(supplierPayments.purchaseOrderId, id));
        if (toCents(paid) > 0) throw new UserError("Payments are recorded against this purchase order, so it can't be cancelled.");
      }
      const [row] = await tx
        .update(purchaseOrders)
        .set({
          status: t.to,
          updatedAt: new Date(),
          ...(action === "send" ? { sentAt: new Date() } : {}),
          ...(action === "confirm" ? { confirmedAt: new Date(), sentAt: po.sentAt ?? new Date() } : {}),
        })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.status, po.status)))
        .returning();
      return row;
    }),
  );
}

/** After goods are booked in: received, partly received, or unchanged. */
export async function refreshPurchaseOrderStatus(tx: DB, poId: string) {
  const lines = await tx.select({ ordered: purchaseOrderItems.orderedQty, received: purchaseOrderItems.receivedQty }).from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, poId));
  const all = lines.length > 0 && lines.every((l) => l.received >= l.ordered);
  const some = lines.some((l) => l.received > 0);
  if (!some) return;
  await tx
    .update(purchaseOrders)
    .set({ status: all ? "received" : "partially_received", updatedAt: new Date() })
    .where(and(eq(purchaseOrders.id, poId), inArray(purchaseOrders.status, ["draft", "sent", "confirmed", "partially_received"])));
}

/** Total paid to the supplier against each purchase order. */
export async function paidByPo(db: DB, poIds: string[]) {
  if (!poIds.length) return new Map<string, number>();
  const rows = await db
    .select({ id: supplierPayments.purchaseOrderId, paid: sql<number>`sum(${supplierPayments.amount})::float8` })
    .from(supplierPayments)
    .where(inArray(supplierPayments.purchaseOrderId, poIds))
    .groupBy(supplierPayments.purchaseOrderId);
  return new Map(rows.map((r) => [r.id, Number(r.paid)]));
}
