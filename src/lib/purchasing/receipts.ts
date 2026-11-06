import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { DB } from "../db";
import { goodsReceiptItems, goodsReceiptNo, goodsReceipts, purchaseOrderItems, purchaseOrders, purchaseReturnItems, purchaseReturns } from "../db/schema";
import { UserError } from "../planning";
import { fillWaiting } from "../stock-allocation";
import { guarded, nextNumber } from "./common";
import { refreshPurchaseOrderStatus } from "./orders";
import { maybeCloseExchange } from "./returns";

const RECEIVABLE = ["sent", "confirmed", "partially_received"] as const;

/** Starts checking in a delivery for a purchase order: one draft line per product still to come. */
export async function startReceiptForPo(db: DB, userId: string, poId: string, receiptDate: string) {
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).limit(1);
  if (!po) throw new UserError("Purchase order not found.");
  if (!(RECEIVABLE as readonly string[]).includes(po.status)) throw new UserError("Only purchase orders sent to or confirmed by the supplier can be received.");
  const [draft] = await db.select({ id: goodsReceipts.id, n: goodsReceipts.grnNumber }).from(goodsReceipts).where(and(eq(goodsReceipts.purchaseOrderId, poId), eq(goodsReceipts.status, "draft"))).limit(1);
  if (draft) throw new UserError(`Goods receipt ${draft.n} for this order is still being checked. Finish or delete it first.`);
  const lines = (await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, poId))).filter((l) => l.receivedQty < l.orderedQty);
  if (!lines.length) throw new UserError("Everything on this purchase order has been received.");
  return db.transaction(async (tx) => {
    const [grn] = await tx
      .insert(goodsReceipts)
      .values({ grnNumber: nextNumber("GRN-", goodsReceiptNo.seqName!), purchaseOrderId: po.id, supplierId: po.supplierId, receiptDate, createdBy: userId })
      .returning();
    await tx.insert(goodsReceiptItems).values(
      lines.map((l) => ({
        goodsReceiptId: grn.id,
        purchaseOrderItemId: l.id,
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        unit: l.unit,
        // Expect the rest of the order; the warehouse changes it to what actually arrived.
        receivedQty: l.orderedQty - l.receivedQty,
        unitCost: l.unitCost,
        gst: l.gst,
      })),
    );
    return grn;
  });
}

/** Replacement goods for an exchange: one draft line per item sent back and not yet replaced. */
export async function startReplacementReceipt(db: DB, userId: string, returnId: string, receiptDate: string) {
  const [r] = await db.select().from(purchaseReturns).where(eq(purchaseReturns.id, returnId)).limit(1);
  if (!r) throw new UserError("Purchase return not found.");
  if (r.refundMethod !== "exchange") throw new UserError("This return is being refunded, not exchanged.");
  if (r.status !== "dispatched") throw new UserError("Replacements can be received once the goods have been sent back.");
  const [draft] = await db.select({ n: goodsReceipts.grnNumber }).from(goodsReceipts).where(and(eq(goodsReceipts.purchaseReturnId, returnId), eq(goodsReceipts.status, "draft"))).limit(1);
  if (draft) throw new UserError(`Goods receipt ${draft.n} for these replacements is still being checked. Finish or delete it first.`);
  const lines = (await db.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseReturnId, returnId))).filter((l) => l.replacedQty < l.dispatchedQty);
  if (!lines.length) throw new UserError("Everything sent back has been replaced.");
  return db.transaction(async (tx) => {
    const [grn] = await tx
      .insert(goodsReceipts)
      .values({ grnNumber: nextNumber("GRN-", goodsReceiptNo.seqName!), purchaseReturnId: r.id, supplierId: r.supplierId, receiptDate, createdBy: userId, notes: `Replacements for ${r.returnNumber}` })
      .returning();
    await tx.insert(goodsReceiptItems).values(
      lines.map((l) => ({
        goodsReceiptId: grn.id,
        purchaseReturnItemId: l.id,
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        unit: l.unit,
        receivedQty: l.dispatchedQty - l.replacedQty,
        unitCost: l.unitCost,
        gst: l.gst,
      })),
    );
    return grn;
  });
}

export type ReceiptUpdate = {
  receiptDate: string;
  deliveryReference: string | null;
  notes: string | null;
  lines: { id: string; receivedQty: number; notes: string | null }[];
};

/** What the warehouse counted, while the receipt is still being checked. */
export async function updateReceipt(db: DB, id: string, input: ReceiptUpdate) {
  return guarded(() =>
    db.transaction(async (tx) => {
      const [grn] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, id)).for("update");
      if (!grn) throw new UserError("Goods receipt not found.");
      if (grn.status !== "draft") throw new UserError("This goods receipt is in stock already and can't be changed.");
      const items = await tx.select().from(goodsReceiptItems).where(eq(goodsReceiptItems.goodsReceiptId, id));
      for (const l of input.lines) {
        const it = items.find((i) => i.id === l.id);
        if (!it) throw new UserError("A line on this receipt no longer exists. Reload the page.");
        await tx.update(goodsReceiptItems).set({ receivedQty: l.receivedQty, notes: l.notes }).where(eq(goodsReceiptItems.id, it.id));
      }
      await tx.update(goodsReceipts).set({ receiptDate: input.receiptDate, deliveryReference: input.deliveryReference, notes: input.notes }).where(eq(goodsReceipts.id, id));
    }),
  );
}

/**
 * Accepts the checked goods into stock. The database trigger adds the stock, writes the ledger and
 * updates the order (or return) lines in this same transaction; then customers waiting for any
 * of these products get them, oldest order first.
 */
export async function postReceipt(db: DB, userId: string, id: string) {
  return guarded(() =>
    db.transaction(async (t) => {
      const tx = t as unknown as DB;
      const [grn] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, id)).for("update");
      if (!grn) throw new UserError("Goods receipt not found.");
      if (grn.status !== "draft") throw new UserError("This goods receipt is already in stock.");
      const items = await tx.select().from(goodsReceiptItems).where(eq(goodsReceiptItems.goodsReceiptId, id));
      const counted = items.filter((i) => i.receivedQty > 0);
      if (!counted.length) throw new UserError("Nothing was received. Enter the quantities that arrived, or delete this receipt.");
      if (counted.some((i) => !Number.isInteger(i.receivedQty))) throw new UserError("Quantities must be whole numbers.");

      // Never more than is still to come (the table CHECK backs this up).
      if (grn.purchaseOrderId) {
        const lines = await tx.select().from(purchaseOrderItems).where(inArray(purchaseOrderItems.id, counted.map((i) => i.purchaseOrderItemId!)));
        for (const i of counted) {
          const l = lines.find((x) => x.id === i.purchaseOrderItemId);
          if (!l) throw new UserError(`${i.sku} is no longer on the purchase order.`);
          if (i.receivedQty > l.orderedQty - l.receivedQty) throw new UserError(`${i.sku}: ${i.receivedQty} received but only ${l.orderedQty - l.receivedQty} still to come on the purchase order.`);
        }
      }
      if (grn.purchaseReturnId) {
        const lines = await tx.select().from(purchaseReturnItems).where(inArray(purchaseReturnItems.id, counted.map((i) => i.purchaseReturnItemId!)));
        for (const i of counted) {
          const l = lines.find((x) => x.id === i.purchaseReturnItemId);
          if (!l || i.receivedQty > l.dispatchedQty - l.replacedQty) throw new UserError(`${i.sku}: more replacements than were sent back.`);
        }
      }

      await tx.update(goodsReceipts).set({ status: "posted", postedBy: userId, postedAt: new Date() }).where(eq(goodsReceipts.id, id));
      if (grn.purchaseOrderId) await refreshPurchaseOrderStatus(tx, grn.purchaseOrderId);
      if (grn.purchaseReturnId) await maybeCloseExchange(tx, grn.purchaseReturnId);
      const filled = await fillWaiting(tx, counted.map((i) => i.productId));
      return { grn, filled };
    }),
  );
}

/** Throws away a receipt that's still being checked. Nothing was in stock yet. */
export async function deleteDraftReceipt(db: DB, id: string) {
  return guarded(async () => {
    const rows = await db.delete(goodsReceipts).where(and(eq(goodsReceipts.id, id), ne(goodsReceipts.status, "posted"))).returning({ id: goodsReceipts.id });
    if (!rows.length) throw new UserError("Only a receipt that's still being checked can be deleted.");
  });
}
