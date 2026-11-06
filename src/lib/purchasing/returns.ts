import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "../db";
import {
  goodsReceiptItems,
  goodsReceipts,
  purchaseReturnItems,
  purchaseReturnNo,
  purchaseReturnPhotos,
  purchaseReturns,
  type ReturnResolution,
  supplierRefundNo,
  supplierRefunds,
  type SupplierPayMethod,
  type SupplierResponseStatus,
} from "../db/schema";
import { UserError } from "../planning";
import { guarded, nextNumber } from "./common";
import { returnValue, toCents } from "./labels";

// We ask the supplier to take goods back; they never send returns to us. The steps:
//   1. request (status open, supplier pending)  — no stock change
//   2. supplier answers: accepted / partially accepted / rejected — no stock change; rejected closes it
//   3. dispatch: accepted goods leave the warehouse — stock goes down here, and only here
//   4. refund recorded (money actually received), or replacements received on a goods receipt
// The quantity rules (accepted ≤ requested, dispatched ≤ accepted, stock only out on dispatch)
// are enforced by the table CHECK and the purchase_return_items trigger, not just this code.

/** How much of a received line other returns already claim: asked for, accepted, or sent back. */
const claimed = sql<number>`coalesce(sum(case
  when ${purchaseReturns.status} = 'cancelled' or ${purchaseReturns.supplierStatus} = 'rejected' then 0
  when ${purchaseReturns.status} in ('dispatched', 'closed') then ${purchaseReturnItems.dispatchedQty}
  else coalesce(${purchaseReturnItems.acceptedQty}, ${purchaseReturnItems.requestedQty}) end), 0)::float8`;

/** Lines of a posted goods receipt and how many of each can still be returned. */
export async function returnableLines(db: DB, goodsReceiptId: string, exceptReturnId?: string) {
  const items = await db.select().from(goodsReceiptItems).where(eq(goodsReceiptItems.goodsReceiptId, goodsReceiptId));
  if (!items.length) return [];
  const used = await db
    .select({ id: purchaseReturnItems.goodsReceiptItemId, qty: claimed })
    .from(purchaseReturnItems)
    .innerJoin(purchaseReturns, eq(purchaseReturns.id, purchaseReturnItems.purchaseReturnId))
    .where(and(inArray(purchaseReturnItems.goodsReceiptItemId, items.map((i) => i.id)), exceptReturnId ? ne(purchaseReturns.id, exceptReturnId) : undefined))
    .groupBy(purchaseReturnItems.goodsReceiptItemId);
  return items.map((i) => {
    const already = Number(used.find((u) => u.id === i.id)?.qty ?? 0);
    return { ...i, alreadyReturned: already, returnable: Math.max(0, i.receivedQty - already) };
  });
}

export type ReturnRequest = {
  goodsReceiptId: string;
  returnDate: string;
  returnReason: string;
  notes: string | null;
  lines: { goodsReceiptItemId: string; qty: number; reason: string | null }[];
  photos: { mime: string; data: Uint8Array }[];
};

/** Step 1: ask the supplier to take goods back. Stock is not touched. */
export async function createReturn(db: DB, userId: string, input: ReturnRequest) {
  if (!input.returnReason.trim()) throw new UserError("Say why the goods are going back.");
  const lines = input.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new UserError("Choose at least one product and how many to return.");
  if (lines.some((l) => !Number.isInteger(l.qty))) throw new UserError("Quantities must be whole numbers.");
  return guarded(() =>
    db.transaction(async (t) => {
      const tx = t as unknown as DB;
      const [grn] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, input.goodsReceiptId)).for("update");
      if (!grn) throw new UserError("Goods receipt not found.");
      if (grn.status !== "posted") throw new UserError("Only goods that have been received into stock can be returned.");
      // The receipt row lock above stops two returns claiming the same goods at once.
      const available = await returnableLines(tx, grn.id);
      const items = lines.map((l) => {
        const a = available.find((x) => x.id === l.goodsReceiptItemId);
        if (!a) throw new UserError("A product isn't on this goods receipt.");
        if (l.qty > a.returnable) throw new UserError(`${a.sku}: only ${a.returnable} of the ${a.receivedQty} received can still be returned.`);
        return { goodsReceiptItemId: a.id, productId: a.productId, sku: a.sku, name: a.name, unit: a.unit, requestedQty: l.qty, unitCost: a.unitCost, gst: a.gst, reason: l.reason };
      });
      const [r] = await tx
        .insert(purchaseReturns)
        .values({
          returnNumber: nextNumber("PR-", purchaseReturnNo.seqName!),
          goodsReceiptId: grn.id,
          supplierId: grn.supplierId,
          returnDate: input.returnDate,
          returnReason: input.returnReason.trim(),
          notes: input.notes,
          createdBy: userId,
        })
        .returning();
      await tx.insert(purchaseReturnItems).values(items.map((it) => ({ ...it, purchaseReturnId: r.id })));
      for (const p of input.photos.slice(0, 8)) await tx.insert(purchaseReturnPhotos).values({ purchaseReturnId: r.id, mime: p.mime, bytes: p.data.byteLength, data: p.data });
      return r;
    }),
  );
}

export type SupplierAnswer = {
  lines: { id: string; acceptedQty: number }[];
  response: string | null;
  resolution: ReturnResolution | null;
};

/** What the accepted quantities add up to: all, some, or none of what we asked for. */
export function responseStatus(lines: { requestedQty: number; acceptedQty: number }[]): SupplierResponseStatus {
  const accepted = lines.reduce((t, l) => t + l.acceptedQty, 0);
  if (accepted === 0) return "rejected";
  return lines.every((l) => l.acceptedQty === l.requestedQty) ? "accepted" : "partially_accepted";
}

/** Step 2: record the supplier's answer. Can be corrected until the goods go out. A rejection closes the return; stock stays. */
export async function recordSupplierResponse(db: DB, userId: string, id: string, input: SupplierAnswer) {
  return guarded(() =>
    db.transaction(async (tx) => {
      const [r] = await tx.select().from(purchaseReturns).where(eq(purchaseReturns.id, id)).for("update");
      if (!r) throw new UserError("Purchase return not found.");
      if (r.status !== "open") throw new UserError("The goods have already gone back (or the return is closed), so the supplier's answer can't change.");
      const items = await tx.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseReturnId, id));
      const answered = items.map((it) => {
        const a = input.lines.find((l) => l.id === it.id);
        const acceptedQty = a ? a.acceptedQty : 0;
        if (!Number.isInteger(acceptedQty) || acceptedQty < 0) throw new UserError("Quantities must be whole numbers.");
        if (acceptedQty > it.requestedQty) throw new UserError(`${it.sku}: the supplier can't accept more than the ${it.requestedQty} asked for.`);
        return { ...it, acceptedQty };
      });
      const status = responseStatus(answered);
      if (status !== "rejected" && !input.resolution) throw new UserError("Choose whether the supplier will refund or exchange the goods.");
      for (const it of answered) await tx.update(purchaseReturnItems).set({ acceptedQty: it.acceptedQty }).where(eq(purchaseReturnItems.id, it.id));
      const [row] = await tx
        .update(purchaseReturns)
        .set({
          supplierStatus: status,
          supplierResponse: input.response,
          refundMethod: status === "rejected" ? null : input.resolution,
          approvedBy: userId,
          respondedAt: new Date(),
          ...(status === "rejected" ? { status: "closed" as const, closedAt: new Date() } : {}),
        })
        .where(eq(purchaseReturns.id, id))
        .returning();
      return row;
    }),
  );
}

/**
 * Step 3: the accepted goods leave the warehouse. This is the only point stock goes down: the
 * trigger on purchase_return_items takes it off (and writes the ledger) as dispatched_qty is set,
 * refusing more than was accepted or more than is free to take.
 */
export async function dispatchReturn(db: DB, userId: string, id: string, lines: { id: string; qty: number }[]) {
  return guarded(() =>
    db.transaction(async (tx) => {
      const [r] = await tx.select().from(purchaseReturns).where(eq(purchaseReturns.id, id)).for("update");
      if (!r) throw new UserError("Purchase return not found.");
      if (r.status !== "open") throw new UserError("This return has already been sent back or closed.");
      if (r.supplierStatus !== "accepted" && r.supplierStatus !== "partially_accepted") throw new UserError("Record the supplier's acceptance before sending the goods back.");
      const items = await tx.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseReturnId, id));
      const plan = items.map((it) => {
        const l = lines.find((x) => x.id === it.id);
        const qty = l ? l.qty : (it.acceptedQty ?? 0);
        if (!Number.isInteger(qty) || qty < 0) throw new UserError("Quantities must be whole numbers.");
        if (qty > (it.acceptedQty ?? 0)) throw new UserError(`${it.sku}: only the ${it.acceptedQty ?? 0} the supplier accepted can go back.`);
        return { it, qty };
      });
      if (!plan.some((p) => p.qty > 0)) throw new UserError("Nothing to send back.");
      // Status first: the trigger only takes stock for a return that's marked as sent.
      await tx.update(purchaseReturns).set({ status: "dispatched", dispatchedAt: new Date(), dispatchedBy: userId }).where(eq(purchaseReturns.id, id));
      for (const { it, qty } of plan) if (qty > 0) await tx.update(purchaseReturnItems).set({ dispatchedQty: qty }).where(eq(purchaseReturnItems.id, it.id));
      return r;
    }),
  );
}

/** What the supplier should pay back for what went back to them, and what they have so far. */
export async function refundPosition(db: DB, id: string) {
  const items = await db.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseReturnId, id));
  const due = returnValue(items.map((i) => ({ qty: i.dispatchedQty, unitCost: i.unitCost, gst: i.gst })));
  const [r] = await db.select({ refunded: purchaseReturns.refundAmount }).from(purchaseReturns).where(eq(purchaseReturns.id, id));
  return { due, refunded: r?.refunded ?? 0, outstanding: Math.max(0, (toCents(due) - toCents(r?.refunded ?? 0)) / 100) };
}

export type RefundInput = { refundDate: string; amount: number; method: SupplierPayMethod; reference: string | null; notes: string | null };

/** Step 4 (refund): money the supplier actually paid back. Closes the return once it's all in. */
export async function recordRefund(db: DB, userId: string, returnId: string, input: RefundInput) {
  if (!(input.amount > 0)) throw new UserError("Enter the amount refunded.");
  return guarded(() =>
    db.transaction(async (t) => {
      const tx = t as unknown as DB;
      const [r] = await tx.select().from(purchaseReturns).where(eq(purchaseReturns.id, returnId)).for("update");
      if (!r) throw new UserError("Purchase return not found.");
      if (r.status !== "dispatched") throw new UserError(r.status === "open" ? "Send the goods back before recording the refund." : "This return is closed.");
      const pos = await refundPosition(tx, returnId);
      if (toCents(input.amount) > toCents(pos.outstanding)) throw new UserError(`That's more than the ${pos.outstanding.toFixed(2)} still to be refunded for the goods sent back.`);
      const [refund] = await tx
        .insert(supplierRefunds)
        .values({ refundNumber: nextNumber("SR-", supplierRefundNo.seqName!), supplierId: r.supplierId, purchaseReturnId: r.id, ...input, createdBy: userId })
        .returning();
      const refunded = (toCents(r.refundAmount) + toCents(input.amount)) / 100;
      const done = r.refundMethod === "refund" && toCents(refunded) >= toCents(pos.due);
      await tx
        .update(purchaseReturns)
        .set({ refundAmount: refunded, ...(done ? { status: "closed" as const, closedAt: new Date() } : {}) })
        .where(eq(purchaseReturns.id, r.id));
      return { refund, closed: done };
    }),
  );
}

/** Step 4 (exchange): called when replacements are booked in. Closes the return once everything sent back has been replaced. */
export async function maybeCloseExchange(tx: DB, returnId: string) {
  const items = await tx.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseReturnId, returnId));
  if (items.length && items.every((i) => i.replacedQty >= i.dispatchedQty)) {
    await tx.update(purchaseReturns).set({ status: "closed", closedAt: new Date() }).where(and(eq(purchaseReturns.id, returnId), eq(purchaseReturns.status, "dispatched")));
  }
}

/** Closes a sent-back return by hand, e.g. the supplier settled for less. */
export async function closeReturn(db: DB, id: string) {
  const [row] = await db.update(purchaseReturns).set({ status: "closed", closedAt: new Date() }).where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.status, "dispatched"))).returning();
  if (!row) throw new UserError("Only a return whose goods have gone back can be closed.");
  return row;
}

/** Withdraws a request before anything has gone back. Stock was never touched. */
export async function cancelReturn(db: DB, id: string) {
  const [row] = await db.update(purchaseReturns).set({ status: "cancelled", closedAt: new Date() }).where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.status, "open"))).returning();
  if (!row) throw new UserError("Only a return that hasn't been sent back can be cancelled.");
  return row;
}
