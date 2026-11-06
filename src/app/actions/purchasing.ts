"use server";

import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import type { ReturnResolution, SupplierPayMethod } from "@/lib/db/schema";
import { UserError } from "@/lib/planning";
import { readUpload } from "@/lib/proofs";
import { dollars, isoDate, isUuid, text, wholeQty } from "@/lib/purchasing/common";
import { PAY_METHODS } from "@/lib/purchasing/labels";
import { createPurchaseOrder, saveSupplier as saveSupplierRow, setPurchaseOrderStatus, updatePurchaseOrder, type PurchaseOrderInput } from "@/lib/purchasing/orders";
import { recordPayment } from "@/lib/purchasing/payments";
import { deleteDraftReceipt, postReceipt, startReceiptForPo, startReplacementReceipt, updateReceipt } from "@/lib/purchasing/receipts";
import { cancelReturn, closeReturn, createReturn, dispatchReturn, recordRefund, recordSupplierResponse } from "@/lib/purchasing/returns";
import { describeFilled } from "@/lib/stock-allocation";

// Purchasing: buying from suppliers, booking goods in, sending faulty goods back. Office and
// warehouse staff do the day-to-day; recording money paid out or refunded is for admins.

function revalidate(...paths: string[]) {
  for (const p of ["/admin/purchase-orders", "/admin/goods-receipts", "/admin/purchase-returns", "/admin/inventory", "/admin/products", "/admin/sales", ...paths]) revalidatePath(p);
}

const id = (v: unknown) => {
  const s = String(v ?? "");
  if (!isUuid(s)) throw new UserError("Not found.");
  return s;
};

const admin = async () => {
  const user = await assertUser(STAFF);
  if (user.role !== "admin") throw new UserError("Only an admin can record money paid or refunded.");
  return user;
};

const payMethod = (v: unknown): SupplierPayMethod => {
  if (!PAY_METHODS.includes(v as SupplierPayMethod)) throw new UserError("Choose how it was paid.");
  return v as SupplierPayMethod;
};

// --- Suppliers --------------------------------------------------------------

export async function saveSupplier(_prev: unknown, form: FormData) {
  return attempt(async () => {
    await assertUser(STAFF);
    const get = (k: string, max = 200) => text(form.get(k), max);
    const supplierId = get("id");
    const s = await saveSupplierRow(await getDb(), supplierId && isUuid(supplierId) ? supplierId : null, {
      name: get("name") ?? "",
      contactName: get("contactName"),
      email: get("email")?.toLowerCase() ?? null,
      phone: get("phone", 40),
      address: get("address", 300),
      abn: get("abn", 20),
      notes: get("notes", 1000),
      active: form.get("active") === "on",
    });
    revalidatePath("/admin/suppliers");
    return { message: `Supplier saved: ${s.name}` };
  });
}

// --- Purchase orders --------------------------------------------------------

export type PoPayload = {
  supplierId: string;
  orderDate: string;
  expectedDate: string;
  supplierReference: string;
  notes: string;
  lines: { productId: string; qty: string; unitCost: string }[];
};

function parsePo(p: PoPayload): PurchaseOrderInput {
  return {
    supplierId: id(p.supplierId),
    orderDate: isoDate(p.orderDate, "the order date"),
    expectedDate: p.expectedDate ? isoDate(p.expectedDate, "the expected delivery date") : null,
    supplierReference: text(p.supplierReference, 100),
    notes: text(p.notes, 2000),
    lines: (Array.isArray(p.lines) ? p.lines : []).slice(0, 300).map((l) => ({ productId: id(l.productId), qty: wholeQty(l.qty, "Quantities", { allowZero: true }), unitCost: dollars(l.unitCost, "Unit cost", 4) })),
  };
}

export async function savePurchaseOrder(poId: string | null, p: PoPayload) {
  return attempt<{ id: string }>(async () => {
    const user = await assertUser(STAFF);
    const db = await getDb();
    if (poId) {
      await updatePurchaseOrder(db, id(poId), parsePo(p));
      revalidate(`/admin/purchase-orders/${poId}`);
      return { message: "Purchase order saved", data: { id: poId } };
    }
    const po = await createPurchaseOrder(db, user.id, parsePo(p));
    revalidate();
    return { message: `Purchase order ${po.poNumber} created`, data: { id: po.id } };
  });
}

export async function changePurchaseOrderStatus(poId: string, action: "send" | "confirm" | "cancel" | "close") {
  return attempt(async () => {
    await assertUser(STAFF);
    const po = await setPurchaseOrderStatus(await getDb(), id(poId), action);
    revalidate(`/admin/purchase-orders/${poId}`);
    const done = { send: "marked as sent to the supplier", confirm: "confirmed by the supplier", cancel: "cancelled", close: "closed" }[action];
    return { message: `${po.poNumber} ${done}` };
  });
}

// --- Goods receipts ---------------------------------------------------------

export async function receiveGoods(source: { poId?: string; returnId?: string }, receiptDate: string) {
  return attempt<{ id: string }>(async () => {
    const user = await assertUser(STAFF);
    const db = await getDb();
    const date = isoDate(receiptDate, "the date the goods arrived");
    const grn = source.poId ? await startReceiptForPo(db, user.id, id(source.poId), date) : await startReplacementReceipt(db, user.id, id(source.returnId), date);
    revalidate();
    return { message: `Goods receipt ${grn.grnNumber} started`, data: { id: grn.id } };
  });
}

export type ReceiptPayload = { receiptDate: string; deliveryReference: string; notes: string; lines: { id: string; receivedQty: string; notes: string }[] };

export async function saveReceipt(grnId: string, p: ReceiptPayload, opts: { post: boolean }) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    const db = await getDb();
    await updateReceipt(db, id(grnId), {
      receiptDate: isoDate(p.receiptDate, "the date the goods arrived"),
      deliveryReference: text(p.deliveryReference, 100),
      notes: text(p.notes, 2000),
      lines: (p.lines ?? []).slice(0, 300).map((l) => ({ id: id(l.id), receivedQty: wholeQty(l.receivedQty, "Quantities received", { allowZero: true }), notes: text(l.notes, 300) })),
    });
    if (!opts.post) {
      revalidate(`/admin/goods-receipts/${grnId}`);
      return { message: "Saved" };
    }
    const { grn, filled } = await postReceipt(db, user.id, id(grnId));
    revalidate(`/admin/goods-receipts/${grnId}`, "/", "/admin");
    const extra = describeFilled(filled);
    return { message: extra ? `${grn.grnNumber} is in stock. ${extra}` : `${grn.grnNumber} is in stock` };
  });
}

export async function removeDraftReceipt(grnId: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    await deleteDraftReceipt(await getDb(), id(grnId));
    revalidate();
    return { message: "Goods receipt deleted" };
  });
}

// --- Purchase returns (we ask the supplier to take goods back) -------------

/** The request form: lines as JSON plus photo files. */
export async function requestReturn(_prev: unknown, form: FormData) {
  return attempt<{ id: string }>(async () => {
    const user = await assertUser(STAFF);
    let lines: { goodsReceiptItemId: string; qty: string; reason: string }[];
    try {
      lines = JSON.parse(String(form.get("lines") ?? "[]"));
    } catch {
      throw new UserError("Choose the products to return.");
    }
    const photos = [];
    for (const f of form.getAll("photos").slice(0, 8)) {
      const p = await readUpload(f, "A photo");
      if (p) photos.push(p);
    }
    const r = await createReturn(await getDb(), user.id, {
      goodsReceiptId: id(form.get("goodsReceiptId")),
      returnDate: isoDate(form.get("returnDate"), "the date"),
      returnReason: text(form.get("returnReason"), 500) ?? "",
      notes: text(form.get("notes"), 2000),
      lines: (Array.isArray(lines) ? lines : []).slice(0, 300).map((l) => ({ goodsReceiptItemId: id(l.goodsReceiptItemId), qty: wholeQty(l.qty, "Quantities", { allowZero: true }), reason: text(l.reason, 300) })),
      photos,
    });
    revalidate();
    return { message: `Return ${r.returnNumber} created. Send it to the supplier and record their answer.`, data: { id: r.id } };
  });
}

export async function saveSupplierResponse(returnId: string, p: { lines: { id: string; acceptedQty: string }[]; response: string; resolution: string }) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    const resolution = p.resolution === "refund" || p.resolution === "exchange" ? (p.resolution as ReturnResolution) : null;
    const r = await recordSupplierResponse(await getDb(), user.id, id(returnId), {
      lines: (p.lines ?? []).map((l) => ({ id: id(l.id), acceptedQty: wholeQty(l.acceptedQty, "Accepted quantities", { allowZero: true }) })),
      response: text(p.response, 2000),
      resolution,
    });
    revalidate(`/admin/purchase-returns/${returnId}`);
    return { message: r.supplierStatus === "rejected" ? "Supplier rejected the return. Stock stays as it is." : "Supplier's answer saved" };
  });
}

export async function sendReturnToSupplier(returnId: string, lines: { id: string; qty: string }[]) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    const r = await dispatchReturn(await getDb(), user.id, id(returnId), (lines ?? []).map((l) => ({ id: id(l.id), qty: wholeQty(l.qty, "Quantities", { allowZero: true }) })));
    revalidate(`/admin/purchase-returns/${returnId}`, "/");
    return { message: `${r.returnNumber}: goods sent back and taken off stock` };
  });
}

export async function finishReturn(returnId: string, action: "close" | "cancel") {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    const r = action === "close" ? await closeReturn(db, id(returnId)) : await cancelReturn(db, id(returnId));
    revalidate(`/admin/purchase-returns/${returnId}`);
    return { message: action === "close" ? `${r.returnNumber} closed` : `${r.returnNumber} cancelled` };
  });
}

// --- Money: payments to suppliers, refunds from suppliers (admins) ----------

export async function addSupplierPayment(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const user = await admin();
    const p = await recordPayment(await getDb(), user.id, {
      purchaseOrderId: id(form.get("purchaseOrderId")),
      paymentDate: isoDate(form.get("date"), "the payment date"),
      amount: dollars(form.get("amount"), "Amount"),
      method: payMethod(form.get("method")),
      reference: text(form.get("reference"), 100),
      notes: text(form.get("notes"), 1000),
    });
    revalidate("/admin/supplier-payments", `/admin/purchase-orders/${p.purchaseOrderId}`);
    return { message: `Payment ${p.paymentNumber} recorded` };
  });
}

export async function addSupplierRefund(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const user = await admin();
    const returnId = id(form.get("purchaseReturnId"));
    const { refund, closed } = await recordRefund(await getDb(), user.id, returnId, {
      refundDate: isoDate(form.get("date"), "the refund date"),
      amount: dollars(form.get("amount"), "Amount"),
      method: payMethod(form.get("method")),
      reference: text(form.get("reference"), 100),
      notes: text(form.get("notes"), 1000),
    });
    revalidate("/admin/supplier-refunds", `/admin/purchase-returns/${returnId}`);
    return { message: closed ? `Refund ${refund.refundNumber} recorded. The return is fully refunded and closed.` : `Refund ${refund.refundNumber} recorded` };
  });
}
