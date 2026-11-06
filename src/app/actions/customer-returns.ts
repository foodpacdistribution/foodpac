"use server";

import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { adjustCredit } from "@/lib/credit";
import { CUSTOMER_RETURN_REASON, REFUND_METHOD } from "@/lib/customer-return-labels";
import { cancelCustomerReturn, completeCustomerReturn, createCustomerReturn, receiveCustomerReturn } from "@/lib/customer-returns";
import { getDb } from "@/lib/db";
import type { CustomerRefundMethod, CustomerReturnReason, CustomerReturnResolution, ReturnedCondition } from "@/lib/db/schema";
import { UserError } from "@/lib/planning";
import { dollars, isUuid, text, wholeQty } from "@/lib/purchasing/common";
import { describeFilled } from "@/lib/stock-allocation";

function revalidate(...paths: string[]) {
  for (const p of ["/admin/customer-returns", "/admin/customer-credit", "/admin/customers", "/admin/sales", "/admin/inventory", "/portal/invoices", ...paths]) revalidatePath(p);
}

const id = (v: unknown) => {
  const s = String(v ?? "");
  if (!isUuid(s)) throw new UserError("Not found.");
  return s;
};

export type CustomerReturnPayload = { salesOrderId: string; reason: string; resolution: string; notes: string; lines: { salesOrderItemId: string; qty: string }[] };

export async function createReturnForCustomer(p: CustomerReturnPayload) {
  return attempt<{ id: string }>(async () => {
    const user = await assertUser(STAFF);
    if (!(p.reason in CUSTOMER_RETURN_REASON)) throw new UserError("Choose why it's coming back.");
    const r = await createCustomerReturn(await getDb(), user.id, {
      salesOrderId: id(p.salesOrderId),
      reason: p.reason as CustomerReturnReason,
      resolution: p.resolution as CustomerReturnResolution,
      notes: text(p.notes, 2000),
      lines: (p.lines ?? []).slice(0, 300).map((l) => ({ salesOrderItemId: id(l.salesOrderItemId), qty: wholeQty(l.qty, "Quantities", { allowZero: true }) })),
    });
    revalidate(`/admin/sales/${p.salesOrderId}`);
    return { message: `Return ${r.returnNumber} created`, data: { id: r.id } };
  });
}

export async function checkInCustomerReturn(returnId: string, lines: { id: string; receivedQty: string; condition: string }[]) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    const { r, filled } = await receiveCustomerReturn(
      await getDb(),
      user.id,
      id(returnId),
      (lines ?? []).map((l) => ({ id: id(l.id), receivedQty: wholeQty(l.receivedQty, "Quantities received", { allowZero: true }), condition: l.condition as ReturnedCondition })),
    );
    revalidate(`/admin/customer-returns/${returnId}`, "/admin/products", "/");
    const extra = describeFilled(filled);
    return { message: extra ? `${r.returnNumber}: goods checked in. ${extra}` : `${r.returnNumber}: goods checked in` };
  });
}

export async function completeReturnForCustomer(returnId: string, refund?: { method: string; reference: string }) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    if (refund && !(refund.method in REFUND_METHOD)) throw new UserError("Choose how the money went back.");
    const r = await completeCustomerReturn(await getDb(), user.id, id(returnId), refund ? { method: refund.method as CustomerRefundMethod, reference: text(refund.reference, 100) } : undefined);
    revalidate(`/admin/customer-returns/${returnId}`, `/admin/customers/${r.customerId}`);
    return { message: r.resolution === "refund" ? `${r.returnNumber}: refund recorded` : `${r.returnNumber}: store credit added to the customer's account` };
  });
}

export async function cancelReturnForCustomer(returnId: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    const r = await cancelCustomerReturn(await getDb(), id(returnId));
    revalidate(`/admin/customer-returns/${returnId}`);
    return { message: `${r.returnNumber} cancelled` };
  });
}

/** Admin only: give credit (goodwill / promotion) or take back credit given in error. */
export async function adjustCustomerCredit(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    if (user.role !== "admin") throw new UserError("Only an admin can give or take back store credit by hand.");
    const kind = String(form.get("kind"));
    if (kind !== "manual_credit" && kind !== "promotion_credit" && kind !== "credit_reversal") throw new UserError("Choose what kind of change this is.");
    const customerId = id(form.get("customerId"));
    const t = await adjustCredit(await getDb(), user.id, customerId, kind, dollars(form.get("amount"), "Amount"), String(form.get("reason") ?? "").slice(0, 300));
    revalidate(`/admin/customers/${customerId}`);
    return { message: `${t.transactionNumber}: store credit now ${new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(t.balanceAfter)}` };
  });
}
